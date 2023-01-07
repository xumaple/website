pub use crate::encrypt::{user2oid, verify_master_key, CryptoError, MasterKey};
pub use mongodb::{
    bson::{doc, from_bson, oid::ObjectId, to_bson, Bson, Document},
    error::Error as MongoError,
    options::{ClientOptions, ResolverConfig},
    Client, Collection,
};
pub use serde::{Deserialize, Serialize};

use once_cell::sync::OnceCell;
use tokio::sync::Mutex;

static DB: OnceCell<Collection<User>> = OnceCell::new();
static DB_INITIALIZED: OnceCell<Mutex<bool>> = OnceCell::new();

pub static OID_LEN: usize = 12;
pub type OID = ObjectId;
pub fn create_oid(id: &[u8; 12]) -> OID {
    let mut oid: [u8; 12] = [0; 12];
    oid.copy_from_slice(id);
    oid.into()
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PasswordKV {
    key: String,
    en_password: String,
}

impl Into<Bson> for PasswordKV {
    fn into(self) -> Bson {
        to_bson(&self).unwrap()
    }
}

impl PasswordKV {
    pub fn to_bson(&self) -> Bson {
        Into::<Bson>::into(self)
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub struct User {
    #[serde(rename = "_id")]
    en_user: ObjectId,
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
    if let Some(_) = DB.get() {
        return Ok(());
    }

    let db_init_lock = DB_INITIALIZED.get_or_init(|| Mutex::new(false));

    let mut db_init_guard = db_init_lock.lock().await;
    if !*db_init_guard {
        // Not yet initialized
        let client = Client::with_options(ClientOptions::parse_with_resolver_config("mongodb+srv://username:temppassword@cluster0.wwznyzn.mongodb.net/?retryWrites=true&w=majority", ResolverConfig::cloudflare()).await?)?;

        DB.set(client.database("users").collection::<User>("users")).expect(
            "PANIC: No one else should be initializing this as this thread holds the DB_INITIALIZED lock",
        );
        *db_init_guard = true;
        drop(db_init_guard);
    }

    Ok(())
}

pub async fn add_user(username: String, password: String) -> Result<(), DbError> {
    let db = DB.get().unwrap();

    let en_user = user2oid(&username);
    if find_user(username, en_user).await.is_ok() {
        return Err(DbError::GenericError {
            error_msg: "Cannot add user because username already exists".to_owned(),
        });
    }

    let mut master_key = MasterKey::new(password)?;
    master_key.encrypt()?;

    db.insert_one(
        &User {
            en_user,
            master_key,
            stored_passwords: vec![],
        },
        None,
    )
    .await?;

    Ok(())
}

pub async fn find_user(username: String, en_user: ObjectId) -> Result<User, DbError> {
    match DB
        .get()
        .unwrap()
        .find_one(
            doc! {
                "_id": en_user
            },
            None,
        )
        .await?
    {
        Some(u) => Ok(u),
        None => {
            return Err(DbError::GenericError {
                error_msg: format!("Cannot find user {} with username {}", en_user, username),
            });
        }
    }
}

pub async fn add_stored_password(
    username: String,
    password: String,
    pwkey: String,
    pwval: String,
) -> Result<(), DbError> {
    let db = DB.get().unwrap();
    let en_user = user2oid(&username);
    let user = find_user(username, en_user).await?;
    verify_master_key(password, &user.master_key)?;

    if user
        .stored_passwords
        .iter()
        .find(|&u| u.key == pwkey)
        .is_some()
    {
        return Err(DbError::GenericError {
            error_msg: format!("Key {} already exists", pwkey),
        });
    }

    db.update_one(
        doc! {
            "_id": en_user
        },
        doc! {
            "$push": {
                "stored_passwords": Into::<Bson>::into(PasswordKV {
                    key: pwkey, en_password: pwval
                })
            }
        },
        None,
    )
    .await?;

    Ok(())
}

pub async fn change_stored_password(
    username: String,
    password: String,
    pwkey: String,
    pwval: String,
) -> Result<(), DbError> {
    let db = DB.get().unwrap();
    let en_user = user2oid(&username);
    let user = find_user(username, en_user).await?;
    verify_master_key(password, &user.master_key)?;

    user.stored_passwords
        .into_iter()
        .find(|u| u.key == pwkey)
        .ok_or(DbError::GenericError {
            error_msg: format!("Key {} doesn't exist", pwkey),
        })?;

    db.update_one(
        doc! {
            "_id": en_user, "stored_passwords.key": pwkey
        },
        doc! {
            "$set": {
                "stored_passwords.$.en_password": pwval
            }
        },
        None,
    )
    .await?;

    Ok(())
}
