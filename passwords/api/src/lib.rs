#[macro_use]
extern crate rocket;

pub mod db;
pub mod encrypt;

use db::DbError;
use encrypt::{generate_password, CryptoError};
use rocket::{
    http::{Header, Status},
    response::Responder,
    serde::json::Json,
    Request, Response as RocketResponse,
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
            "Preparing error response. Recorded error: {}\n{:#?}",
            self,
            self,
        );

        let simple_response = "Error.".to_owned();

        RocketResponse::build()
            .status(Status::NotFound)
            .header(Header::new("Access-Control-Allow-Origin", "*"))
            .sized_body(simple_response.len(), Cursor::new(simple_response))
            .ok()
    }
}

#[derive(Responder)]
pub struct Response {
    status: Status,
    cors: Header<'static>,
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
    cors: Header<'static>,
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
fn new_password() -> Result<JsonResponse<String>, Error> {
    JsonResponse::Ok(generate_password()?)
}

#[get("/get/verifyuser?<username>&<password>")]
async fn verify_user(username: String, password: String) -> Result<Response, Error> {
    db::verify_user(username, password).await?;
    Response::Ok()
}

#[post("/post/newuser?<username>&<password>")]
async fn create_user(username: String, password: String) -> Result<Response, Error> {
    db::add_user(username, password).await?;
    Response::Ok()
}

#[post(
    "/post/updateuser?<username>&<password>&<new_password>",
    data = "<new_stored_passwords>"
)]
async fn update_user(
    username: String,
    password: String,
    new_password: String,
    new_stored_passwords: Json<Vec<String>>,
) -> Result<Response, Error> {
    db::change_master_password(
        username,
        password,
        new_password,
        new_stored_passwords.into_inner(),
    )
    .await?;
    Response::Ok()
}

#[get("/get/getkeys?<username>&<password>")]
async fn get_stored_keys(
    username: String,
    password: String,
) -> Result<JsonResponse<Vec<String>>, Error> {
    JsonResponse::Ok(db::get_stored_keys(username, password).await?)
}

#[get("/get/getpw/<pwkey>?<username>&<password>")]
async fn get_stored_password(
    username: String,
    password: String,
    pwkey: String,
) -> Result<JsonResponse<String>, Error> {
    JsonResponse::Ok(db::get_stored_password(username, password, pwkey).await?)
}

#[get("/get/getpws?<username>&<password>")]
async fn get_stored_passwords(
    username: String,
    password: String,
) -> Result<JsonResponse<Vec<String>>, Error> {
    JsonResponse::Ok(db::get_stored_passwords(username, password).await?)
}

#[post("/post/newpw/<pwkey>?<username>&<password>&<pwval>")]
async fn add_stored_password(
    username: String,
    password: String,
    pwkey: String,
    pwval: String,
) -> Result<Response, Error> {
    db::add_stored_password(username, password, pwkey, pwval).await?;
    Response::Ok()
}

#[post("/post/changepw/<pwkey>?<username>&<password>&<pwval>")]
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

/// Delete a user by username. Only available in debug/test builds for cleanup.
#[cfg(any(test, debug_assertions, feature = "test-helpers"))]
#[post("/post/deleteuser?<username>")]
async fn delete_user(username: String) -> Result<Response, Error> {
    db::delete_user(&username).await?;
    Response::Ok()
}

pub fn build_rocket() -> rocket::Rocket<rocket::Build> {
    let rocket = rocket::build()
        .mount(
            "/api/v1",
            routes![
                new_password,
                create_user,
                verify_user,
                update_user,
                get_stored_keys,
                get_stored_password,
                get_stored_passwords,
                add_stored_password,
                change_stored_password,
            ],
        )
        .mount("/", routes![root]);

    #[cfg(any(test, debug_assertions, feature = "test-helpers"))]
    let rocket = rocket.mount("/api/v1", routes![delete_user]);

    rocket
}
