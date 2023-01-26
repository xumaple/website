#[macro_use]
extern crate rocket;

pub mod db;
pub mod encrypt;

use db::DbError;
use encrypt::{generate_password, CryptoError};
use rocket::{
    http::{Status, Header},
    response::Responder,
    Request, Response as RocketResponse,
    serde::json::Json,
};
use std::io::Cursor;

#[derive(thiserror::Error, Debug)]
pub enum Error {
    #[error("Error doing cryptography work")]
    CryptoError(#[from] CryptoError),
    #[error("Error accessing database")]
    DbError(#[from] DbError),
}

impl<'r> Responder<'r, 'static> for Error {
    fn respond_to(self, _: &'r Request<'_>) -> Result<RocketResponse<'static>, Status> {
        println!(
            "Preparing error response. Recorded error: {}\n{:?}",
            self.to_string(),
            self,
        );

        let simple_response = "Error.".to_owned();

        RocketResponse::build()
            .status(Status::NotFound)
            //.header(ContentType::JSON)
            .header(Header::new("Access-Control-Allow-Origin", "*"))
            .sized_body(simple_response.len(), Cursor::new(simple_response))
            .ok()
    }
}


#[derive(Responder)]
pub struct Response {
    status: Status,
    cors: Header<'static>
}
impl Response {
    #[allow(non_snake_case)]
    pub fn Ok() -> Result<Self, Error> {
        println!("Returning response Ok");
        Ok(Response {
            status: Status::Ok,
            cors: Header::new("Access-Control-Allow-Origin", "*"),
        })
    }
}

#[derive(Responder)]
#[response(status = 200, content_type = "json")]
pub struct JsonResponse<T> {
    msg: Json<T>,
    cors: Header<'static>
}
impl<T> JsonResponse<T> {
    #[allow(non_snake_case)]
    pub fn Ok(json: T) -> Result<Self, Error> {
        println!("Returning response Ok");
        Ok(JsonResponse {
            msg: Json(json),
            cors: Header::new("Access-Control-Allow-Origin", "*"),
        })
    }
}


#[get("/get/newpw")]
fn new_password() -> Result<String, Error> {
    Ok(generate_password()?)
}

#[get("/get/verifyuser/<username>/<password>")]
async fn verify_user(username: String, password: String) -> Result<Response, Error> {
    db::verify_user(username, password).await?;
    Response::Ok()
}

#[post("/post/newuser/<username>/<password>")]
async fn create_user(username: String, password: String) -> Result<Response, Error> {
    db::add_user(username, password).await?;
    Response::Ok()
}

#[post("/post/updateuser/<username>/<password>/<new_password>", 
       data = "<new_stored_passwords>")]
async fn update_user(username: String, password: String, new_password: String, new_stored_passwords: Json<Vec<String>>) -> Result<Response, Error> {
    db::change_master_password(username,
        password,
        new_password,
        new_stored_passwords.into_inner()
    ).await?;
    Response::Ok()
}

#[get("/get/getpws/<username>/<password>")]
async fn get_stored_passwords(username: String, password: String) -> Result<JsonResponse<Vec<String>>, Error> {
    JsonResponse::Ok(db::get_stored_passwords(username, password).await?)
}

#[post("/post/newpw/<username>/<password>/<pwkey>/<pwval>")]
async fn add_stored_password(
    username: String,
    password: String,
    pwkey: String,
    pwval: String,
) -> Result<Response, Error> {
    db::add_stored_password(username, password, pwkey, pwval).await?;
    Response::Ok()
}

#[post("/post/changepw/<username>/<password>/<pwkey>/<pwval>")]
async fn change_stored_password(
    username: String,
    password: String,
    pwkey: String,
    pwval: String,
) -> Result<Response, Error> {
    db::change_stored_password(username, password, pwkey, pwval).await?;
    Response::Ok()
}

#[get("/")]
async fn root() -> String {
    "Don't get hacked".to_owned()
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
                verify_user,
                update_user,
                get_stored_passwords,
                add_stored_password,
                change_stored_password,
            ],
        )
        .mount(
            "/",
            routes![
                root
            ]
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
