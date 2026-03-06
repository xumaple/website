pub mod db;
pub mod encrypt;

use axum::{
    extract::{FromRequestParts, Path},
    http::{header::HeaderName, request::Parts, HeaderValue, Method, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use db::DbError;
use encrypt::{generate_password, Credentials, CryptoError};
use serde::Deserialize;
use tower_http::cors::CorsLayer;

#[derive(thiserror::Error, Debug)]
pub enum Error {
    #[error("Error doing cryptography work")]
    CryptoError(#[from] CryptoError),
    #[error("Error accessing database")]
    DbError(#[from] DbError),
}

impl IntoResponse for Error {
    fn into_response(self) -> axum::response::Response {
        println!(
            "Preparing error response. Recorded error: {}\n{:#?}",
            self, self,
        );
        (StatusCode::NOT_FOUND, "Error.").into_response()
    }
}

// ---------------------------------------------------------------------------
// CORS layer
// ---------------------------------------------------------------------------

/// Build a CORS layer from the `FRONTEND_ORIGIN` env var.
///
/// The variable should contain one or more origins separated by commas
/// (e.g. `https://passwords.maplexu.me,http://localhost:3000`).
/// Panics if the variable is not set.
fn cors_layer() -> CorsLayer {
    let raw =
        std::env::var("FRONTEND_ORIGIN").expect("Need FRONTEND_ORIGIN env variable");
    let origins: Vec<HeaderValue> = raw
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(|s| s.parse().expect("Invalid origin in FRONTEND_ORIGIN"))
        .collect();

    CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            HeaderName::from_static("x-username"),
            HeaderName::from_static("x-password"),
            HeaderName::from_static("content-type"),
        ])
}

// ---------------------------------------------------------------------------
// Credentials extractor from headers
// ---------------------------------------------------------------------------

impl<S> FromRequestParts<S> for Credentials
where
    S: Send + Sync,
{
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let username = parts
            .headers
            .get("x-username")
            .and_then(|v: &HeaderValue| v.to_str().ok())
            .map(|s| s.to_string());
        let password = parts
            .headers
            .get("x-password")
            .and_then(|v: &HeaderValue| v.to_str().ok())
            .map(|s| s.to_string());

        match (username, password) {
            (Some(u), Some(p)) => Ok(Credentials {
                username: u,
                password: p,
            }),
            _ => Err((StatusCode::UNAUTHORIZED, "Missing credentials")),
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

async fn generate() -> Result<Json<String>, Error> {
    let pw = generate_password()?;
    println!("Returning response Ok");
    Ok(Json(pw))
}

async fn create_user(creds: Credentials) -> Result<StatusCode, Error> {
    db::add_user(creds).await?;
    println!("Returning response Ok");
    Ok(StatusCode::OK)
}

async fn verify_user(creds: Credentials) -> Result<StatusCode, Error> {
    db::verify_user(creds).await?;
    println!("Returning response Ok");
    Ok(StatusCode::OK)
}

async fn update_user(
    creds: Credentials,
    Json(payload): Json<UpdateUserPayload>,
) -> Result<StatusCode, Error> {
    db::change_master_password(creds, payload.new_password, payload.passwords).await?;
    println!("Returning response Ok");
    Ok(StatusCode::OK)
}

async fn get_stored_keys(creds: Credentials) -> Result<Json<Vec<String>>, Error> {
    let keys = db::get_stored_keys(creds).await?;
    println!("Returning response Ok");
    Ok(Json(keys))
}

async fn get_stored_password(
    creds: Credentials,
    Path(key): Path<String>,
) -> Result<Json<String>, Error> {
    let pw = db::get_stored_password(creds, key).await?;
    println!("Returning response Ok");
    Ok(Json(pw))
}

async fn get_stored_passwords(creds: Credentials) -> Result<Json<Vec<String>>, Error> {
    let pws = db::get_stored_passwords(creds).await?;
    println!("Returning response Ok");
    Ok(Json(pws))
}

async fn add_stored_password(
    creds: Credentials,
    Path(key): Path<String>,
    Json(payload): Json<PasswordPayload>,
) -> Result<StatusCode, Error> {
    db::add_stored_password(creds, key, payload.encrypted_password).await?;
    println!("Returning response Ok");
    Ok(StatusCode::OK)
}

async fn change_stored_password(
    creds: Credentials,
    Path(key): Path<String>,
    Json(payload): Json<PasswordPayload>,
) -> Result<StatusCode, Error> {
    db::change_stored_password(creds, key, payload.encrypted_password).await?;
    println!("Returning response Ok");
    Ok(StatusCode::OK)
}

async fn root() -> &'static str {
    "Don't get hacked"
}

/// Delete a user. Only available in debug/test builds for cleanup.
#[cfg(any(test, debug_assertions, feature = "test-helpers"))]
async fn delete_user(creds: Credentials) -> Result<StatusCode, Error> {
    db::delete_user(creds.username).await?;
    println!("Returning response Ok");
    Ok(StatusCode::OK)
}

// ---------------------------------------------------------------------------
// Application builder
// ---------------------------------------------------------------------------

pub fn build_router() -> Router {
    let app = Router::new()
        .route("/api/v2/generate", get(generate))
        .route("/api/v2/user", post(create_user).put(update_user))
        .route("/api/v2/user/verify", get(verify_user))
        .route("/api/v2/keys", get(get_stored_keys))
        .route(
            "/api/v2/passwords/{key}",
            get(get_stored_password)
                .post(add_stored_password)
                .put(change_stored_password),
        )
        .route("/api/v2/passwords", get(get_stored_passwords))
        .route("/", get(root));

    #[cfg(any(test, debug_assertions, feature = "test-helpers"))]
    let app = app.route("/api/v2/user", axum::routing::delete(delete_user));

    app.layer(cors_layer())
}
