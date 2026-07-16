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

// ---------------------------------------------------------------------------
// Document model: buckets of labeled, client-side-encrypted fields
// ---------------------------------------------------------------------------

/// Current document shape. Documents at older versions must be migrated
/// (see `bin/migrate_v2`) before the API will serve them.
pub const SCHEMA_VERSION: u32 = 2;

/// A single labeled value inside a bucket. `en_value` is AES-encrypted
/// client-side; the server never sees plaintext. `sensitive` is a UI hint:
/// mask + click-to-copy vs. shown inline.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Field {
    pub label: String,
    pub en_value: String,
    pub sensitive: bool,
}

/// A named collection of fields, e.g. everything belonging to "github".
/// Bucket keys are unique per user; field labels are unique per bucket.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Bucket {
    pub key: String,
    pub fields: Vec<Field>,
}

impl From<Field> for Bson {
    fn from(field: Field) -> Bson {
        to_bson(&field).unwrap()
    }
}

impl From<Bucket> for Bson {
    fn from(bucket: Bucket) -> Bson {
        to_bson(&bucket).unwrap()
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
    #[serde(default)]
    schema_version: u32,
    #[serde(default)]
    buckets: Vec<Bucket>,
}

impl User {
    /// Find the bucket with the given key, or error if it doesn't exist.
    fn bucket(&self, key: &str) -> Result<&Bucket, DbError> {
        self.buckets
            .iter()
            .find(|b| b.key == key)
            .ok_or_else(|| DbError::GenericError {
                error_msg: format!("Bucket {} doesn't exist", key),
            })
    }

    /// Error if a bucket with the given key already exists.
    fn assert_no_bucket(&self, key: &str) -> Result<(), DbError> {
        if self.buckets.iter().any(|b| b.key == key) {
            return Err(DbError::GenericError {
                error_msg: format!("Bucket {} already exists", key),
            });
        }
        Ok(())
    }
}

/// Error if any two fields share a label.
fn assert_unique_labels(fields: &[Field]) -> Result<(), DbError> {
    for (i, f) in fields.iter().enumerate() {
        if fields[..i].iter().any(|other| other.label == f.label) {
            return Err(DbError::GenericError {
                error_msg: format!("Duplicate field label {}", f.label),
            });
        }
    }
    Ok(())
}

/// The structural shape of a bucket list: bucket keys with their field
/// labels, in order. Two vaults match structurally iff their shapes are
/// equal — i.e. only the encrypted values differ.
fn buckets_shape(buckets: &[Bucket]) -> Vec<(&str, Vec<&str>)> {
    buckets
        .iter()
        .map(|b| {
            (
                b.key.as_str(),
                b.fields.iter().map(|f| f.label.as_str()).collect(),
            )
        })
        .collect()
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
    creds: &Credentials,
) -> Result<(&'static Collection<User>, User, OID), DbError> {
    let db = DB.get().unwrap();
    let en_user = user2oid(&creds.username);
    let mut user = find_user(&creds.username, en_user).await?;
    if user.schema_version != SCHEMA_VERSION {
        return Err(DbError::GenericError {
            error_msg: format!(
                "User document is at schema version {} (expected {SCHEMA_VERSION}); run the migration",
                user.schema_version
            ),
        });
    }
    user.master_key.verify(&creds.password)?;

    // Lazy re-hash: this is the only moment the plaintext password is in
    // hand, so upgrade hashes derived under an older iteration target now.
    // A rehash failure must not fail authentication.
    if user.master_key.needs_rehash() {
        match rehash_master_key(db, en_user, &creds.password).await {
            Ok(Some(new_mk)) => user.master_key = new_mk,
            Ok(None) => {}
            Err(e) => tracing::warn!(error = %e, "failed to re-hash master key"),
        }
    }

    Ok((db, user, en_user))
}

/// Re-derive the master key hash at the current iteration target and store it.
/// Acquires the per-user lock and re-reads the user (TOCTOU): only writes if
/// the password still verifies against the re-read key and it still needs a
/// rehash. Returns the new key so the caller can keep its snapshot in sync,
/// or `None` if a concurrent request made the rehash unnecessary or invalid.
async fn rehash_master_key(
    db: &Collection<User>,
    en_user: OID,
    password: &str,
) -> Result<Option<MasterKey>, DbError> {
    let _guard = acquire_user_lock(en_user).await;

    let current_user = find_user("", en_user).await?;
    if current_user.master_key.verify(password).is_err()
        || !current_user.master_key.needs_rehash()
    {
        return Ok(None);
    }

    let new_mk = MasterKey::new(password)?;
    let new_iterations = new_mk.iterations;
    db.update_one(
        doc! {
            "_id": en_user
        },
        doc! {
            "$set": {
                "master_key": to_bson(&new_mk).unwrap()
            }
        },
    )
    .await?;
    tracing::info!(
        old_iterations = current_user.master_key.iterations,
        new_iterations,
        "re-hashed master key"
    );

    Ok(Some(new_mk))
}

/// Acquire the per-user lock, then re-read the user to detect TOCTOU: if
/// another request changed the master password between the caller's
/// authenticate_user call and the lock acquisition, the stored master_pw
/// will have changed. Returns the guard (which must be held for the duration
/// of the mutating operation) together with the freshly-read user, whose
/// state callers must use for existence/duplicate checks.
async fn lock_and_reread(
    user: &User,
    en_user: OID,
    password: &str,
) -> Result<(tokio::sync::OwnedMutexGuard<()>, User), DbError> {
    let guard = acquire_user_lock(en_user).await;
    let current_user = find_user("", en_user).await?;
    // A hash mismatch is either a genuine concurrent master-password change
    // or a concurrent lazy re-hash of the SAME password (fresh salt +
    // iterations). Only the former must abort; re-verifying the plaintext
    // disambiguates, and costs a PBKDF2 pass only on this rare mismatch path.
    if current_user.master_key.master_pw != user.master_key.master_pw
        && current_user.master_key.verify(password).is_err()
    {
        return Err(DbError::GenericError {
            error_msg: "Master password was changed by a concurrent request".to_owned(),
        });
    }
    Ok((guard, current_user))
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
            schema_version: SCHEMA_VERSION,
            buckets: vec![],
        },
    )
    .await?;

    Ok(())
}

pub async fn verify_user(creds: Credentials) -> Result<(), DbError> {
    let _ = authenticate_user(&creds).await?;
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

pub async fn get_bucket_keys(creds: Credentials) -> Result<Vec<String>, DbError> {
    let (_, user, _) = authenticate_user(&creds).await?;
    Ok(user.buckets.into_iter().map(|b| b.key).collect())
}

/// Full buckets with encrypted values — used by the client to re-encrypt
/// everything when changing the master password.
pub async fn get_all_buckets(creds: Credentials) -> Result<Vec<Bucket>, DbError> {
    let (_, user, _) = authenticate_user(&creds).await?;
    Ok(user.buckets)
}

pub async fn get_bucket(creds: Credentials, key: String) -> Result<Bucket, DbError> {
    let (_, user, _) = authenticate_user(&creds).await?;
    Ok(user.bucket(&key)?.clone())
}

pub async fn create_bucket(
    creds: Credentials,
    key: String,
    fields: Vec<Field>,
) -> Result<(), DbError> {
    let (db, user, en_user) = authenticate_user(&creds).await?;
    let (_guard, current_user) = lock_and_reread(&user, en_user, &creds.password).await?;

    current_user.assert_no_bucket(&key)?;
    assert_unique_labels(&fields)?;

    db.update_one(
        doc! {
            "_id": en_user
        },
        doc! {
            "$push": {
                "buckets": Bson::from(Bucket { key, fields })
            }
        },
    )
    .await?;

    Ok(())
}

pub async fn rename_bucket(
    creds: Credentials,
    key: String,
    new_key: String,
) -> Result<(), DbError> {
    let (db, user, en_user) = authenticate_user(&creds).await?;
    let (_guard, current_user) = lock_and_reread(&user, en_user, &creds.password).await?;

    current_user.bucket(&key)?;
    current_user.assert_no_bucket(&new_key)?;

    db.update_one(
        doc! {
            "_id": en_user, "buckets.key": key
        },
        doc! {
            "$set": {
                "buckets.$.key": new_key
            }
        },
    )
    .await?;

    Ok(())
}

pub async fn delete_bucket(creds: Credentials, key: String) -> Result<(), DbError> {
    let (db, user, en_user) = authenticate_user(&creds).await?;
    let (_guard, current_user) = lock_and_reread(&user, en_user, &creds.password).await?;

    current_user.bucket(&key)?;

    db.update_one(
        doc! {
            "_id": en_user
        },
        doc! {
            "$pull": {
                "buckets": { "key": key }
            }
        },
    )
    .await?;

    Ok(())
}

/// Creates the field if its label is new to the bucket, otherwise updates it
/// in place. Errors if the bucket doesn't exist.
pub async fn upsert_field(creds: Credentials, key: String, field: Field) -> Result<(), DbError> {
    let (db, user, en_user) = authenticate_user(&creds).await?;
    let (_guard, current_user) = lock_and_reread(&user, en_user, &creds.password).await?;

    let bucket = current_user.bucket(&key)?;

    if bucket.fields.iter().any(|f| f.label == field.label) {
        db.update_one(
            doc! {
                "_id": en_user
            },
            doc! {
                "$set": {
                    "buckets.$[b].fields.$[f].en_value": field.en_value,
                    "buckets.$[b].fields.$[f].sensitive": field.sensitive,
                }
            },
        )
        .array_filters(vec![
            doc! { "b.key": key },
            doc! { "f.label": field.label },
        ])
        .await?;
    } else {
        db.update_one(
            doc! {
                "_id": en_user, "buckets.key": key
            },
            doc! {
                "$push": {
                    "buckets.$.fields": Bson::from(field)
                }
            },
        )
        .await?;
    }

    Ok(())
}

pub async fn delete_field(
    creds: Credentials,
    key: String,
    label: String,
) -> Result<(), DbError> {
    let (db, user, en_user) = authenticate_user(&creds).await?;
    let (_guard, current_user) = lock_and_reread(&user, en_user, &creds.password).await?;

    let bucket = current_user.bucket(&key)?;
    if !bucket.fields.iter().any(|f| f.label == label) {
        return Err(DbError::GenericError {
            error_msg: format!("Field {} doesn't exist in bucket {}", label, key),
        });
    }

    db.update_one(
        doc! {
            "_id": en_user, "buckets.key": key
        },
        doc! {
            "$pull": {
                "buckets.$.fields": { "label": label }
            }
        },
    )
    .await?;

    Ok(())
}

/// The client re-encrypts every field value under the new master password
/// and sends the full replacement `buckets` array. The structure (bucket
/// keys and field labels, in order) must match what's stored — only the
/// encrypted values may differ.
pub async fn change_master_password(
    creds: Credentials,
    new_password: String,
    new_buckets: Vec<Bucket>,
) -> Result<(), DbError> {
    let (db, user, en_user) = authenticate_user(&creds).await?;
    let (_guard, current_user) = lock_and_reread(&user, en_user, &creds.password).await?;

    if buckets_shape(&current_user.buckets) != buckets_shape(&new_buckets) {
        return Err(DbError::GenericError {
            error_msg: "Updated buckets don't structurally match stored buckets".to_owned(),
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
                "buckets": new_buckets
                    .into_iter()
                    .map(Bson::from)
                    .collect::<Vec<Bson>>()
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
    use crate::encrypt::N_ITER;
    use mongodb::bson::from_bson;

    fn field(label: &str, en_value: &str) -> Field {
        Field {
            label: label.to_string(),
            en_value: en_value.to_string(),
            sensitive: true,
        }
    }

    fn bucket(key: &str, fields: Vec<Field>) -> Bucket {
        Bucket {
            key: key.to_string(),
            fields,
        }
    }

    #[test]
    fn test_oid_len_constant() {
        assert_eq!(OID_LEN, 12);
    }

    #[test]
    fn test_field_serialization_roundtrip() {
        let f = Field {
            label: "password".to_string(),
            en_value: "encrypted_value_here".to_string(),
            sensitive: true,
        };

        let serialized = serde_json::to_string(&f).unwrap();
        let deserialized: Field = serde_json::from_str(&serialized).unwrap();

        assert_eq!(deserialized.label, f.label);
        assert_eq!(deserialized.en_value, f.en_value);
        assert_eq!(deserialized.sensitive, f.sensitive);
    }

    #[test]
    fn test_bucket_serialization_roundtrip() {
        let b = bucket(
            "gmail",
            vec![field("password", "enc_pw"), field("email", "enc_email")],
        );

        let serialized = serde_json::to_string(&b).unwrap();
        let deserialized: Bucket = serde_json::from_str(&serialized).unwrap();

        assert_eq!(deserialized.key, "gmail");
        assert_eq!(deserialized.fields.len(), 2);
        assert_eq!(deserialized.fields[0].label, "password");
        assert_eq!(deserialized.fields[1].label, "email");
    }

    #[test]
    fn test_field_into_bson() {
        let f = Field {
            label: "username".to_string(),
            en_value: "enc_username".to_string(),
            sensitive: false,
        };

        let bson: Bson = f.into();

        if let Bson::Document(doc) = bson {
            assert_eq!(doc.get_str("label").unwrap(), "username");
            assert_eq!(doc.get_str("en_value").unwrap(), "enc_username");
            assert!(!doc.get_bool("sensitive").unwrap());
        } else {
            panic!("Expected Bson::Document");
        }
    }

    #[test]
    fn test_bucket_into_bson() {
        let b = bucket("github", vec![field("password", "cipher1")]);

        let bson: Bson = b.into();

        if let Bson::Document(doc) = bson {
            assert_eq!(doc.get_str("key").unwrap(), "github");
            let fields = doc.get_array("fields").unwrap();
            assert_eq!(fields.len(), 1);
            let f = fields[0].as_document().unwrap();
            assert_eq!(f.get_str("label").unwrap(), "password");
            assert_eq!(f.get_str("en_value").unwrap(), "cipher1");
            assert!(f.get_bool("sensitive").unwrap());
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
            let iterations = doc
                .get_i32("iterations")
                .map(i64::from)
                .or_else(|_| doc.get_i64("iterations"))
                .unwrap();
            assert_eq!(iterations, i64::from(N_ITER));
        } else {
            panic!("Expected Bson::Document");
        }
    }

    #[test]
    fn test_user_serialization() {
        let user = User {
            en_user: OID::from_bytes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
            master_key: MasterKey::new("password").unwrap(),
            schema_version: SCHEMA_VERSION,
            buckets: vec![
                bucket("site1", vec![field("password", "enc1")]),
                bucket(
                    "site2",
                    vec![field("password", "enc2"), field("email", "enc3")],
                ),
            ],
        };

        let bson = to_bson(&user).unwrap();
        let deserialized: User = from_bson(bson).unwrap();

        assert_eq!(deserialized.en_user, user.en_user);
        assert_eq!(deserialized.schema_version, SCHEMA_VERSION);
        assert_eq!(deserialized.buckets.len(), 2);
        assert_eq!(deserialized.buckets[0].key, "site1");
        assert_eq!(deserialized.buckets[1].key, "site2");
        assert_eq!(deserialized.buckets[1].fields.len(), 2);
    }

    #[test]
    fn test_user_missing_schema_fields_default() {
        // A pre-migration document has neither schema_version nor buckets.
        let bson = to_bson(&doc! {
            "_id": OID::from_bytes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
            "master_key": { "master_pw": "AB", "salt": "CD" },
        })
        .unwrap();
        let user: User = from_bson(bson).unwrap();

        assert_eq!(user.schema_version, 0);
        assert!(user.buckets.is_empty());
        assert_ne!(user.schema_version, SCHEMA_VERSION);
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

    // ── User bucket lookup helpers ─────────────────────────────────────────

    fn test_user_with_buckets(buckets: Vec<Bucket>) -> User {
        User {
            en_user: OID::from_bytes([0; 12]),
            master_key: MasterKey::new("pw").unwrap(),
            schema_version: SCHEMA_VERSION,
            buckets,
        }
    }

    #[test]
    fn test_bucket_lookup_finds_existing_and_rejects_missing() {
        let user = test_user_with_buckets(vec![
            bucket("gmail", vec![field("password", "enc1")]),
            bucket("github", vec![]),
        ]);

        assert_eq!(user.bucket("github").unwrap().key, "github");
        assert!(user.bucket("nonexistent").is_err());
    }

    #[test]
    fn test_assert_no_bucket() {
        let user = test_user_with_buckets(vec![bucket("gmail", vec![])]);

        assert!(user.assert_no_bucket("gmail").is_err());
        assert!(user.assert_no_bucket("new_key").is_ok());
    }

    #[test]
    fn test_assert_unique_labels() {
        assert!(assert_unique_labels(&[]).is_ok());
        assert!(assert_unique_labels(&[field("password", "a")]).is_ok());
        assert!(
            assert_unique_labels(&[field("password", "a"), field("email", "b")]).is_ok()
        );
        assert!(
            assert_unique_labels(&[field("password", "a"), field("password", "b")]).is_err()
        );
    }

    // ── Structural-match logic used by change_master_password ──────────────

    #[test]
    fn test_buckets_shape_matches_when_only_values_differ() {
        let stored = vec![
            bucket(
                "gmail",
                vec![field("password", "old1"), field("email", "old2")],
            ),
            bucket("github", vec![field("password", "old3")]),
        ];
        let updated = vec![
            bucket(
                "gmail",
                vec![field("password", "new1"), field("email", "new2")],
            ),
            bucket("github", vec![field("password", "new3")]),
        ];

        assert_eq!(buckets_shape(&stored), buckets_shape(&updated));
    }

    #[test]
    fn test_buckets_shape_rejects_structural_changes() {
        let stored = vec![bucket(
            "gmail",
            vec![field("password", "old1"), field("email", "old2")],
        )];

        // Different bucket key
        let renamed = vec![bucket(
            "gmail2",
            vec![field("password", "new1"), field("email", "new2")],
        )];
        assert_ne!(buckets_shape(&stored), buckets_shape(&renamed));

        // Missing field
        let missing_field = vec![bucket("gmail", vec![field("password", "new1")])];
        assert_ne!(buckets_shape(&stored), buckets_shape(&missing_field));

        // Extra bucket
        let extra_bucket = vec![
            bucket(
                "gmail",
                vec![field("password", "new1"), field("email", "new2")],
            ),
            bucket("extra", vec![]),
        ];
        assert_ne!(buckets_shape(&stored), buckets_shape(&extra_bucket));

        // Reordered fields count as a structural change (sequences compared in order)
        let reordered = vec![bucket(
            "gmail",
            vec![field("email", "new2"), field("password", "new1")],
        )];
        assert_ne!(buckets_shape(&stored), buckets_shape(&reordered));
    }

    #[test]
    fn test_buckets_shape_empty_vaults_match() {
        assert_eq!(buckets_shape(&[]), buckets_shape(&[]));
    }
}
