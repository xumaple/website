use crate::encrypt::{user2oid, Credentials, CryptoError, MasterKey};
use crate::env::EnvVars;
use dashmap::DashMap;
use mongodb::{
    bson::{doc, oid::ObjectId, to_bson, Bson},
    error::Error as MongoError,
    options::ClientOptions,
    Client, Collection,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

static DB: tokio::sync::OnceCell<Collection<User>> = tokio::sync::OnceCell::const_new();

// ---------------------------------------------------------------------------
// Per-user lock map for serializing mutating requests
// ---------------------------------------------------------------------------

/// A shared map from user ObjectId to a per-user async mutex.
/// All mutating (write) db functions acquire the lock for the target user
/// before proceeding, preventing race conditions on concurrent writes.
static USER_LOCKS: std::sync::LazyLock<DashMap<ObjectId, Arc<tokio::sync::Mutex<()>>>> =
    std::sync::LazyLock::new(DashMap::new);

/// Acquire the per-user async mutex for the given OID, returning the guard.
/// The guard must be held for the duration of the mutating operation.
async fn acquire_user_lock(oid: ObjectId) -> tokio::sync::OwnedMutexGuard<()> {
    let mutex = USER_LOCKS
        .entry(oid)
        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone();
    mutex.lock_owned().await
}

pub static OID_LEN: usize = 12;
pub type OID = ObjectId;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PasswordKV {
    key: String,
    en_password: String,
}

impl From<PasswordKV> for Bson {
    fn from(kv: PasswordKV) -> Bson {
        to_bson(&kv).unwrap()
    }
}

impl From<MasterKey> for Bson {
    fn from(mk: MasterKey) -> Bson {
        to_bson(&mk).unwrap()
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub struct User {
    #[serde(rename = "_id")]
    en_user: OID,
    master_key: MasterKey,
    stored_passwords: Vec<PasswordKV>,
}

#[derive(thiserror::Error, Debug)]
pub enum DbError {
    #[error("Error processing crypto")]
    CryptoError(#[from] CryptoError),
    #[error("Error querying MongoDB")]
    MongoError(#[from] MongoError),
    #[error("Error: {error_msg:?}")]
    GenericError { error_msg: String },
}

pub async fn connect() -> Result<(), DbError> {
    DB.get_or_try_init(|| async {
        let env = EnvVars::get();
        let client = Client::with_options(
            ClientOptions::parse(
                format!(
                    "mongodb+srv://{}:{}@{}?retryWrites=true&w=majority",
                    env.mongo_user, env.mongo_pw, env.mongo_endpoint,
                )
                .as_str(),
            )
            .await?,
        )?;
        Ok::<_, DbError>(client.database(&env.users_db_name).collection::<User>("users"))
    })
    .await?;
    Ok(())
}

async fn authenticate_user(
    creds: Credentials,
) -> Result<(&'static Collection<User>, User, OID), DbError> {
    let db = DB.get().unwrap();
    let en_user = user2oid(&creds.username);
    let user = find_user(&creds.username, en_user).await?;
    user.master_key.verify(&creds.password)?;
    Ok((db, user, en_user))
}

pub async fn add_user(creds: Credentials) -> Result<(), DbError> {
    let db = DB.get().unwrap();

    let en_user = user2oid(&creds.username);
    let _guard = acquire_user_lock(en_user).await;

    if find_user(&creds.username, en_user).await.is_ok() {
        return Err(DbError::GenericError {
            error_msg: "Cannot add user because username already exists".to_owned(),
        });
    }

    let master_key = MasterKey::new(&creds.password)?;

    db.insert_one(
        &User {
            en_user,
            master_key,
            stored_passwords: vec![],
        },
    )
    .await?;

    Ok(())
}

pub async fn verify_user(creds: Credentials) -> Result<(), DbError> {
    let _ = authenticate_user(creds).await?;
    Ok(())
}

pub async fn find_user(username: &str, en_user: OID) -> Result<User, DbError> {
    match DB
        .get()
        .unwrap()
        .find_one(
            doc! {
                "_id": en_user
            },
        )
        .await?
    {
        Some(u) => Ok(u),
        None => Err(DbError::GenericError {
            error_msg: format!("Cannot find user {} with username {}", en_user, username),
        })
    }
}

pub async fn get_stored_keys(creds: Credentials) -> Result<Vec<String>, DbError> {
    let (_, user, _) = authenticate_user(creds).await?;
    Ok(user.stored_passwords.into_iter().map(|kv| kv.key).collect())
}

pub async fn get_stored_password(
    creds: Credentials,
    key: String,
) -> Result<String, DbError> {
    let (_, user, _) = authenticate_user(creds).await?;
    user.stored_passwords
        .into_iter()
        .find(|kv| key == kv.key)
        .map(|kv| kv.en_password)
        .ok_or_else(|| DbError::GenericError {
            error_msg: format!("Unable to find key {}", key),
        })
}

pub async fn get_stored_passwords(
    creds: Credentials,
) -> Result<Vec<String>, DbError> {
    let (_, user, _) = authenticate_user(creds).await?;
    Ok(user
        .stored_passwords
        .into_iter()
        .map(|kv| kv.en_password)
        .collect())
}

pub async fn add_stored_password(
    creds: Credentials,
    key: String,
    encrypted_password: String,
) -> Result<(), DbError> {
    let (db, user, en_user) = authenticate_user(creds).await?;
    let _guard = acquire_user_lock(en_user).await;

    // Re-read the user after acquiring the lock to detect TOCTOU: if another
    // request changed the master password between our authenticate_user call
    // and the lock acquisition, the stored master_pw will have changed.
    let current_user = find_user("", en_user).await?;
    if current_user.master_key.master_pw != user.master_key.master_pw {
        return Err(DbError::GenericError {
            error_msg: "Master password was changed by a concurrent request".to_owned(),
        });
    }

    if user
        .stored_passwords
        .iter()
        .any(|u| u.key == key)
    {
        return Err(DbError::GenericError {
            error_msg: format!("Key {} already exists", key),
        });
    }

    db.update_one(
        doc! {
            "_id": en_user
        },
        doc! {
            "$push": {
                "stored_passwords": Bson::from(PasswordKV {
                    key, en_password: encrypted_password
                })
            }
        },
    )
    .await?;

    Ok(())
}

pub async fn change_stored_password(
    creds: Credentials,
    key: String,
    encrypted_password: String,
) -> Result<(), DbError> {
    let (db, user, en_user) = authenticate_user(creds).await?;
    let _guard = acquire_user_lock(en_user).await;

    user.stored_passwords
        .into_iter()
        .find(|u| u.key == key)
        .ok_or_else(|| DbError::GenericError {
            error_msg: format!("Key {} doesn't exist", key),
        })?;

    db.update_one(
        doc! {
            "_id": en_user, "stored_passwords.key": key
        },
        doc! {
            "$set": {
                "stored_passwords.$.en_password": encrypted_password
            }
        },
    )
    .await?;

    Ok(())
}

pub async fn change_master_password(
    creds: Credentials,
    new_password: String,
    updated_stored_passwords: Vec<String>,
) -> Result<(), DbError> {
    let (db, user, en_user) = authenticate_user(creds).await?;
    let _guard = acquire_user_lock(en_user).await;

    // Re-read the user after acquiring the lock to detect TOCTOU: if another
    // request changed the master password between our authenticate_user call
    // and the lock acquisition, the stored master_pw will have changed.
    let current_user = find_user("", en_user).await?;
    if current_user.master_key.master_pw != user.master_key.master_pw {
        return Err(DbError::GenericError {
            error_msg: "Master password was changed by a concurrent request".to_owned(),
        });
    }

    if user.stored_passwords.len() != updated_stored_passwords.len() {
        return Err(DbError::GenericError {
            error_msg: format!(
                "Expected {} updated passwords, found {}",
                user.stored_passwords.len(),
                updated_stored_passwords.len()
            ),
        });
    }

    let new_mk = MasterKey::new(&new_password)?;

    db.update_one(
        doc! {
            "_id": en_user
        },
        doc! {
            "$set": {
                "master_key": Bson::from(new_mk),
                "stored_passwords": user.stored_passwords
                    .into_iter()
                    .zip(updated_stored_passwords.into_iter())
                    .map(|(kv, en_password)| PasswordKV { key: kv.key, en_password })
                    .collect::<Vec<PasswordKV>>()
            }
        },
    )
    .await?;

    Ok(())
}

/// Deletes a user by username. Only available in debug/test builds.
#[cfg(any(test, debug_assertions, feature = "test-helpers"))]
pub async fn delete_user(username: String) -> Result<(), DbError> {
    let db = DB.get().unwrap();
    let en_user = user2oid(&username);
    let _guard = acquire_user_lock(en_user).await;
    db.delete_one(doc! { "_id": en_user }).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::from_bson;

    #[test]
    fn test_oid_len_constant() {
        assert_eq!(OID_LEN, 12);
    }

    #[test]
    fn test_password_kv_serialization() {
        let kv = PasswordKV {
            key: "gmail".to_string(),
            en_password: "encrypted_password_here".to_string(),
        };
        
        let serialized = serde_json::to_string(&kv).unwrap();
        let deserialized: PasswordKV = serde_json::from_str(&serialized).unwrap();
        
        assert_eq!(deserialized.key, kv.key);
        assert_eq!(deserialized.en_password, kv.en_password);
    }

    #[test]
    fn test_password_kv_into_bson() {
        let kv = PasswordKV {
            key: "test_key".to_string(),
            en_password: "test_value".to_string(),
        };
        
        let bson: Bson = kv.clone().into();
        
        // Should convert to a document with key and en_password fields
        if let Bson::Document(doc) = bson {
            assert_eq!(doc.get_str("key").unwrap(), "test_key");
            assert_eq!(doc.get_str("en_password").unwrap(), "test_value");
        } else {
            panic!("Expected Bson::Document");
        }
    }

    #[test]
    fn test_master_key_into_bson() {
        let mk = MasterKey::new("test_password").unwrap();
        let original_pw = mk.master_pw.clone();
        let original_salt = mk.salt.clone();
        
        let bson: Bson = mk.into();
        
        if let Bson::Document(doc) = bson {
            assert_eq!(doc.get_str("master_pw").unwrap(), original_pw);
            assert_eq!(doc.get_str("salt").unwrap(), original_salt);
        } else {
            panic!("Expected Bson::Document");
        }
    }

    #[test]
    fn test_user_serialization() {
        let user = User {
            en_user: OID::from_bytes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
            master_key: MasterKey::new("password").unwrap(),
            stored_passwords: vec![
                PasswordKV {
                    key: "site1".to_string(),
                    en_password: "enc1".to_string(),
                },
                PasswordKV {
                    key: "site2".to_string(),
                    en_password: "enc2".to_string(),
                },
            ],
        };
        
        let bson = to_bson(&user).unwrap();
        let deserialized: User = from_bson(bson).unwrap();
        
        assert_eq!(deserialized.en_user, user.en_user);
        assert_eq!(deserialized.stored_passwords.len(), 2);
        assert_eq!(deserialized.stored_passwords[0].key, "site1");
        assert_eq!(deserialized.stored_passwords[1].key, "site2");
    }

    #[test]
    fn test_db_error_from_crypto_error() {
        let crypto_err = CryptoError::UnspecifiedRingError;
        let db_err: DbError = crypto_err.into();
        
        match db_err {
            DbError::CryptoError(_) => (), // Expected
            _ => panic!("Expected DbError::CryptoError"),
        }
    }

    #[test]
    fn test_db_error_generic_error_display() {
        let err = DbError::GenericError {
            error_msg: "Test error message".to_string(),
        };
        
        let display = format!("{}", err);
        assert!(display.contains("Test error message"));
    }

    #[test]
    fn test_password_kv_clone() {
        let original = PasswordKV {
            key: "original_key".to_string(),
            en_password: "original_password".to_string(),
        };
        
        let cloned = original.clone();
        
        assert_eq!(cloned.key, original.key);
        assert_eq!(cloned.en_password, original.en_password);
    }

    // Test helper function for validating password update logic
    fn validate_password_update_count(
        stored_len: usize,
        updated_len: usize,
    ) -> Result<(), &'static str> {
        if stored_len != updated_len {
            return Err("Password count mismatch");
        }
        Ok(())
    }

    #[test]
    fn test_password_update_validation_matching_counts() {
        assert!(validate_password_update_count(5, 5).is_ok());
        assert!(validate_password_update_count(0, 0).is_ok());
    }

    #[test]
    fn test_password_update_validation_mismatched_counts() {
        assert!(validate_password_update_count(5, 3).is_err());
        assert!(validate_password_update_count(0, 1).is_err());
    }

    // Test the zip-map logic used in change_master_password
    #[test]
    fn test_password_kv_update_mapping() {
        let original_passwords = vec![
            PasswordKV {
                key: "gmail".to_string(),
                en_password: "old_enc1".to_string(),
            },
            PasswordKV {
                key: "github".to_string(),
                en_password: "old_enc2".to_string(),
            },
        ];
        
        let new_encrypted = vec!["new_enc1".to_string(), "new_enc2".to_string()];
        
        let updated: Vec<PasswordKV> = original_passwords
            .into_iter()
            .zip(new_encrypted)
            .map(|(kv, en_password)| PasswordKV {
                key: kv.key,
                en_password,
            })
            .collect();
        
        assert_eq!(updated.len(), 2);
        assert_eq!(updated[0].key, "gmail");
        assert_eq!(updated[0].en_password, "new_enc1");
        assert_eq!(updated[1].key, "github");
        assert_eq!(updated[1].en_password, "new_enc2");
    }

    // Test find logic used in get_stored_password
    #[test]
    fn test_find_password_by_key() {
        let passwords = [
            PasswordKV {
                key: "gmail".to_string(),
                en_password: "gmail_enc".to_string(),
            },
            PasswordKV {
                key: "github".to_string(),
                en_password: "github_enc".to_string(),
            },
        ];
        
        let found = passwords.iter().find(|kv| kv.key == "github");
        assert!(found.is_some());
        assert_eq!(found.unwrap().en_password, "github_enc");
        
        let not_found = passwords.iter().find(|kv| kv.key == "nonexistent");
        assert!(not_found.is_none());
    }

    // Test the key extraction logic used in get_stored_keys
    #[test]
    fn test_extract_keys_from_passwords() {
        let passwords = vec![
            PasswordKV {
                key: "gmail".to_string(),
                en_password: "enc1".to_string(),
            },
            PasswordKV {
                key: "github".to_string(),
                en_password: "enc2".to_string(),
            },
            PasswordKV {
                key: "twitter".to_string(),
                en_password: "enc3".to_string(),
            },
        ];
        
        let keys: Vec<String> = passwords.into_iter().map(|kv| kv.key).collect();
        
        assert_eq!(keys, vec!["gmail", "github", "twitter"]);
    }

    // Test the duplicate key detection logic used in add_stored_password
    #[test]
    fn test_duplicate_key_detection() {
        let passwords = [
            PasswordKV {
                key: "gmail".to_string(),
                en_password: "enc1".to_string(),
            },
            PasswordKV {
                key: "github".to_string(),
                en_password: "enc2".to_string(),
            },
        ];
        
        let has_gmail = passwords.iter().any(|u| u.key == "gmail");
        let has_twitter = passwords.iter().any(|u| u.key == "twitter");
        
        assert!(has_gmail);
        assert!(!has_twitter);
    }
}
