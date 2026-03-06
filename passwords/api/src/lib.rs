#[macro_use]
extern crate rocket;

pub mod db;
pub mod encrypt;

use db::DbError;
use encrypt::{generate_password, Credentials, CryptoError};
use rocket::{
    fairing::{Fairing, Info, Kind},
    http::{Header, Status},
    request::{self, FromRequest},
    response::Responder,
    serde::json::Json,
    Request, Response as RocketResponse,
};
use serde::Deserialize;
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
            .sized_body(simple_response.len(), Cursor::new(simple_response))
            .ok()
    }
}

#[derive(Responder)]
pub struct Response {
    status: Status,
}
impl Response {
    #[allow(non_snake_case)]
    pub fn Ok() -> Result<Self, Error> {
        println!("Returning response Ok");
        Ok(Response {
            status: Status::Ok,
        })
    }
}

#[derive(Responder)]
#[response(status = 200, content_type = "json")]
pub struct JsonResponse<T> {
    msg: Json<T>,
}
impl<T> JsonResponse<T> {
    #[allow(non_snake_case)]
    pub fn Ok(json: T) -> Result<Self, Error> {
        println!("Returning response Ok");
        Ok(JsonResponse { msg: Json(json) })
    }
}

// ---------------------------------------------------------------------------
// CORS fairing
// ---------------------------------------------------------------------------

const ALLOWED_ORIGINS: &[&str] = &[
    "https://passwords.maplexu.me",
    "http://localhost:3000",
];

pub struct Cors;

#[rocket::async_trait]
impl Fairing for Cors {
    fn info(&self) -> Info {
        Info {
            name: "CORS",
            kind: Kind::Response,
        }
    }

    async fn on_response<'r>(&self, req: &'r Request<'_>, res: &mut RocketResponse<'r>) {
        if let Some(origin) = req.headers().get_one("Origin") {
            if ALLOWED_ORIGINS.contains(&origin) {
                res.set_header(Header::new("Access-Control-Allow-Origin", origin.to_string()));
                res.set_header(Header::new("Access-Control-Allow-Credentials", "true"));
                res.set_header(Header::new(
                    "Access-Control-Allow-Methods",
                    "GET, POST, PUT, DELETE, OPTIONS",
                ));
                res.set_header(Header::new(
                    "Access-Control-Allow-Headers",
                    "x-username, x-password, Content-Type",
                ));
            }
        }
    }
}

/// Catch-all OPTIONS handler for CORS preflight requests.
#[options("/<_..>")]
fn cors_preflight() -> Status {
    Status::NoContent
}

// ---------------------------------------------------------------------------
// Request guard: extract credentials from headers
// ---------------------------------------------------------------------------

#[rocket::async_trait]
impl<'r> FromRequest<'r> for Credentials {
    type Error = ();

    async fn from_request(req: &'r Request<'_>) -> request::Outcome<Self, Self::Error> {
        match (
            req.headers().get_one("x-username"),
            req.headers().get_one("x-password"),
        ) {
            (Some(u), Some(p)) => request::Outcome::Success(Credentials {
                username: u.to_string(),
                password: p.to_string(),
            }),
            _ => request::Outcome::Error((Status::Unauthorized, ())),
        }
    }
}

// ---------------------------------------------------------------------------
// Request payloads
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct UpdateUserPayload {
    pub new_password: String,
    pub passwords: Vec<String>,
}

#[derive(Deserialize)]
pub struct PasswordPayload {
    pub encrypted_password: String,
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

#[get("/generate")]
fn generate() -> Result<JsonResponse<String>, Error> {
    JsonResponse::Ok(generate_password()?)
}

#[post("/user")]
async fn create_user(creds: Credentials) -> Result<Response, Error> {
    db::add_user(creds).await?;
    Response::Ok()
}

#[get("/user/verify")]
async fn verify_user(creds: Credentials) -> Result<Response, Error> {
    db::verify_user(creds).await?;
    Response::Ok()
}

#[put("/user", data = "<payload>")]
async fn update_user(
    creds: Credentials,
    payload: Json<UpdateUserPayload>,
) -> Result<Response, Error> {
    let p = payload.into_inner();
    db::change_master_password(creds, p.new_password, p.passwords)
        .await?;
    Response::Ok()
}

#[get("/keys")]
async fn get_stored_keys(creds: Credentials) -> Result<JsonResponse<Vec<String>>, Error> {
    JsonResponse::Ok(db::get_stored_keys(creds).await?)
}

#[get("/passwords/<key>")]
async fn get_stored_password(
    creds: Credentials,
    key: String,
) -> Result<JsonResponse<String>, Error> {
    JsonResponse::Ok(db::get_stored_password(creds, key).await?)
}

#[get("/passwords")]
async fn get_stored_passwords(creds: Credentials) -> Result<JsonResponse<Vec<String>>, Error> {
    JsonResponse::Ok(db::get_stored_passwords(creds).await?)
}

#[post("/passwords/<key>", data = "<payload>")]
async fn add_stored_password(
    creds: Credentials,
    key: String,
    payload: Json<PasswordPayload>,
) -> Result<Response, Error> {
    db::add_stored_password(creds, key, payload.into_inner().encrypted_password)
        .await?;
    Response::Ok()
}

#[put("/passwords/<key>", data = "<payload>")]
async fn change_stored_password(
    creds: Credentials,
    key: String,
    payload: Json<PasswordPayload>,
) -> Result<Response, Error> {
    db::change_stored_password(creds, key, payload.into_inner().encrypted_password)
        .await?;
    Response::Ok()
}

#[get("/")]
async fn root() -> String {
    "Don't get hacked".to_owned()
}

/// Delete a user. Only available in debug/test builds for cleanup.
#[cfg(any(test, debug_assertions, feature = "test-helpers"))]
#[delete("/user")]
async fn delete_user(creds: Credentials) -> Result<Response, Error> {
    db::delete_user(creds.username).await?;
    Response::Ok()
}

// ---------------------------------------------------------------------------
// Application builder
// ---------------------------------------------------------------------------

pub fn build_rocket() -> rocket::Rocket<rocket::Build> {
    let rocket = rocket::build()
        .attach(Cors)
        .mount(
            "/api/v2",
            routes![
                generate,
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
        .mount("/", routes![root, cors_preflight]);

    #[cfg(any(test, debug_assertions, feature = "test-helpers"))]
    let rocket = rocket.mount("/api/v2", routes![delete_user]);

    rocket
}
