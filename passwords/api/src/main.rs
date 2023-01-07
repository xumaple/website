#[macro_use]
extern crate rocket;

pub mod db;
pub mod encrypt;

use db::DbError;
use encrypt::{generate_password, verify_master_key, CryptoError, MasterKey};
use rocket::{
    http::{ContentType, Status},
    response::Responder,
    Request, Response,
};
use serde::Serialize;
use std::io::Cursor;

// fn main() -> Result<(), CryptoError> {
//     // let master = "abcdef".to_owned();
//     // let key = MasterKey::new(master)?;
//     // let encrypted_master = encrypt_master_key(&key)?;

//     // println!("{}", encrypted_master);
//     // println!("{}", generate_password().unwrap());

//     // assert!(verify_master_key(&key, encrypted_master).is_ok());

//     println!("{}", user2oid("abc".to_owned()));
//     println!("{}", user2oid("abc".to_owned()));
//     println!("{}", user2oid("abcdefghijklmnopqrs".to_owned()));
//     println!("{}", user2oid("abcdefghijklmnopqrs".to_owned()));

//     Ok(())
// }

#[derive(thiserror::Error, Debug)]
pub enum Error {
    #[error("Error doing cryptography work")]
    CryptoError(#[from] CryptoError),
    #[error("Error accessing database")]
    DbError(#[from] DbError),
}

impl<'r> Responder<'r, 'static> for Error {
    fn respond_to(self, _: &'r Request<'_>) -> Result<Response<'static>, Status> {
        println!(
            "Preparing error response. Recorded error: {}\n{:?}",
            self.to_string(),
            self,
        );

        let simple_response = "Error.".to_owned();

        Response::build()
            .status(Status::NotFound)
            .header(ContentType::JSON)
            .sized_body(simple_response.len(), Cursor::new(simple_response))
            .ok()
    }
}

#[get("/get/newpw")]
fn new_password() -> Result<String, Error> {
    Ok(generate_password()?)
}

#[post("/post/newuser/<username>/<password>")]
async fn create_user(username: String, password: String) -> Result<Status, Error> {
    db::add_user(username, password).await?;
    Ok(Status::Ok)
}

#[post("/post/newpw/<username>/<password>/<pwkey>/<pwval>")]
async fn add_stored_password(
    username: String,
    password: String,
    pwkey: String,
    pwval: String,
) -> Result<Status, Error> {
    db::add_stored_password(username, password, pwkey, pwval).await?;
    Ok(Status::Ok)
}

#[post("/post/changepw/<username>/<password>/<pwkey>/<pwval>")]
async fn change_stored_password(
    username: String,
    password: String,
    pwkey: String,
    pwval: String,
) -> Result<Status, Error> {
    db::change_stored_password(username, password, pwkey, pwval).await?;
    Ok(Status::Ok)
}

// #[get("get/")]
#[rocket::main]
async fn main() -> Result<(), anyhow::Error> {
    db::connect().await?;

    let _rocket = rocket::build()
        .mount(
            "/api/v1",
            routes![
                new_password,
                create_user,
                add_stored_password,
                change_stored_password
            ],
        )
        .launch()
        .await?;

    Ok(())
}

/*
1) Use encrypt_master_key to hash the given mk with salt to store in db, so we don't store naked mk
2) Use verify_master_key to ensure that anytime we get a mk, that it's the right mk
3) APP calls generate_password to get a new pw.
4) APP encrypts new pw with mk, then sends it with tablekey to be stored
5) APP asks for encrypted pw via tablekey, then decrypts locally with mk to use pw.

Q: Which of 3, 4, 5 does APP need to send the mk?
A: 4 and 5, mk is the authentication; not 3 because that just gives a randomly generated iteration
*/
