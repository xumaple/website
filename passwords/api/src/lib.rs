pub mod db;
pub mod encrypt;
pub mod env;

use axum::{
    extract::{rejection::PathRejection, FromRequestParts, Path},
    http::{header::HeaderName, request::Parts, HeaderValue, Method, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use axum_prometheus::metrics_exporter_prometheus::PrometheusHandle;
use axum_prometheus::PrometheusMetricLayer;
use db::DbError;
use encrypt::{generate_password, Credentials, CryptoError};
use env::EnvVars;
use serde::Deserialize;
use std::sync::OnceLock;
use tower_governor::governor::GovernorConfigBuilder;
use tower_governor::GovernorLayer;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

const MAX_KEY_LENGTH: usize = 128;

// ---------------------------------------------------------------------------
// Rate limiting configuration
// ---------------------------------------------------------------------------

/// How often the rate limiter replenishes one token (in milliseconds).
/// With a burst size of 10, this gives ~10 requests/second sustained.
const RATE_LIMIT_REPLENISH_PERIOD_MS: u64 = 100;

/// Maximum burst size — the number of requests a client can make
/// before being throttled.
pub const RATE_LIMIT_BURST_SIZE: u32 = 10;

// ---------------------------------------------------------------------------
// Router configuration
// ---------------------------------------------------------------------------

/// Configuration for building the application router.
///
/// Use [`RouterConfig::default()`] for production settings, or construct
/// manually to override values (e.g. in tests).
pub struct RouterConfig {
    /// Maximum number of requests a client can make before being throttled.
    pub burst_size: u32,
}

impl Default for RouterConfig {
    fn default() -> Self {
        Self {
            burst_size: RATE_LIMIT_BURST_SIZE,
        }
    }
}

fn is_valid_key_length(key: &str) -> bool {
    key.len() <= MAX_KEY_LENGTH
}

/// A password key name that has been validated for length.
pub struct ValidatedKey(pub String);

impl<S> FromRequestParts<S> for ValidatedKey
where
    S: Send + Sync,
{
    type Rejection = Error;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let Path(key) = Path::<String>::from_request_parts(parts, state)
            .await?;
        let len = key.len();
        is_valid_key_length(&key)
            .then_some(ValidatedKey(key))
            .ok_or(Error::KeyTooLong(len))
    }
}

#[derive(thiserror::Error, Debug)]
pub enum Error {
    #[error("Error doing cryptography work")]
    CryptoError(#[from] CryptoError),
    #[error("Error accessing database")]
    DbError(#[from] DbError),
    #[error("Missing or unparseable credentials headers")]
    MissingCredentials,
    #[error("Path parameter extraction failed")]
    InvalidPath(#[from] PathRejection),
    #[error("Key length {0} exceeds {MAX_KEY_LENGTH}-character limit")]
    KeyTooLong(usize),
}

impl IntoResponse for Error {
    fn into_response(self) -> axum::response::Response {
        tracing::error!(error = %self, "request failed");
        (StatusCode::NOT_FOUND, "Error.").into_response()
    }
}

// ---------------------------------------------------------------------------
// CORS layer
// ---------------------------------------------------------------------------

/// Build a CORS layer from the `FRONTEND_ORIGIN` env var.
///
/// The variable should contain one or more origins separated by commas
/// (e.g. `https://example.com,http://localhost:3000`).
fn cors_layer() -> CorsLayer {
    let origins: Vec<HeaderValue> = EnvVars::get()
        .frontend_origin
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
    type Rejection = Error;

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
            _ => Err(Error::MissingCredentials),
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

#[tracing::instrument]
async fn generate() -> Result<Json<String>, Error> {
    let pw = generate_password()?;
    tracing::info!("ok");
    Ok(Json(pw))
}

#[tracing::instrument(skip(creds))]
async fn create_user(creds: Credentials) -> Result<StatusCode, Error> {
    db::add_user(creds).await?;
    tracing::info!("ok");
    Ok(StatusCode::OK)
}

#[tracing::instrument(skip(creds))]
async fn verify_user(creds: Credentials) -> Result<StatusCode, Error> {
    db::verify_user(creds).await?;
    tracing::info!("ok");
    Ok(StatusCode::OK)
}

#[tracing::instrument(skip(creds, payload))]
async fn update_user(
    creds: Credentials,
    Json(payload): Json<UpdateUserPayload>,
) -> Result<StatusCode, Error> {
    db::change_master_password(creds, payload.new_password, payload.passwords).await?;
    tracing::info!("ok");
    Ok(StatusCode::OK)
}

#[tracing::instrument(skip(creds))]
async fn get_stored_keys(creds: Credentials) -> Result<Json<Vec<String>>, Error> {
    let keys = db::get_stored_keys(creds).await?;
    tracing::info!("ok");
    Ok(Json(keys))
}

#[tracing::instrument(skip(creds))]
async fn get_stored_password(
    creds: Credentials,
    ValidatedKey(key): ValidatedKey,
) -> Result<Json<String>, Error> {
    let pw = db::get_stored_password(creds, key).await?;
    tracing::info!("ok");
    Ok(Json(pw))
}

#[tracing::instrument(skip(creds))]
async fn get_stored_passwords(creds: Credentials) -> Result<Json<Vec<String>>, Error> {
    let pws = db::get_stored_passwords(creds).await?;
    tracing::info!("ok");
    Ok(Json(pws))
}

#[tracing::instrument(skip(creds, payload))]
async fn add_stored_password(
    creds: Credentials,
    ValidatedKey(key): ValidatedKey,
    Json(payload): Json<PasswordPayload>,
) -> Result<StatusCode, Error> {
    db::add_stored_password(creds, key, payload.encrypted_password).await?;
    tracing::info!("ok");
    Ok(StatusCode::OK)
}

#[tracing::instrument(skip(creds, payload))]
async fn change_stored_password(
    creds: Credentials,
    ValidatedKey(key): ValidatedKey,
    Json(payload): Json<PasswordPayload>,
) -> Result<StatusCode, Error> {
    db::change_stored_password(creds, key, payload.encrypted_password).await?;
    tracing::info!("ok");
    Ok(StatusCode::OK)
}

#[tracing::instrument]
async fn root() -> &'static str {
    "Don't get hacked"
}

/// Delete a user. Only available in debug/test builds for cleanup.
#[cfg(any(test, debug_assertions, feature = "test-helpers"))]
#[tracing::instrument(skip(creds))]
async fn delete_user(creds: Credentials) -> Result<StatusCode, Error> {
    db::delete_user(creds.username).await?;
    tracing::info!("ok");
    Ok(StatusCode::OK)
}

// ---------------------------------------------------------------------------
// Prometheus metrics (initialized at most once per process)
// ---------------------------------------------------------------------------

/// Stores the Prometheus metric layer and handle so that
/// `PrometheusMetricLayer::pair()` (which installs a global recorder) is
/// called at most once. Subsequent calls to `prometheus_pair()` clone the
/// stored values.
static PROMETHEUS: OnceLock<(PrometheusMetricLayer<'static>, PrometheusHandle)> = OnceLock::new();

/// Return a `(layer, handle)` pair, creating it on the first call and
/// cloning the cached values on every subsequent call.
fn prometheus_pair() -> (PrometheusMetricLayer<'static>, PrometheusHandle) {
    PROMETHEUS
        .get_or_init(PrometheusMetricLayer::pair)
        .clone()
}

// ---------------------------------------------------------------------------
// Application builder
// ---------------------------------------------------------------------------

/// Register all application routes (including conditional test-only routes).
fn app_routes() -> Router {
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

    app
}

/// Build the full application [`Router`] with all middleware layers.
///
/// Includes CORS, per-IP rate limiting, Prometheus metrics collection
/// (exposed at `/metrics`), and HTTP tracing.  Safe to call multiple
/// times in the same process — the Prometheus recorder is initialised
/// at most once and reused on subsequent calls.
///
/// Use [`RouterConfig::default()`] for production settings.  Tests can
/// override individual fields (e.g. a large `burst_size` to avoid
/// accidental 429s, or a small one to exercise throttling).
pub fn build_router(config: RouterConfig) -> Router {
    let burst_size = config.burst_size;
    let (prometheus_layer, metric_handle) = prometheus_pair();

    let app = app_routes()
        .route("/metrics", get(|| async move { metric_handle.render() }));

    // Build the rate limiter configuration.
    let mut rate_limit_builder = GovernorConfigBuilder::default()
        .const_per_millisecond(RATE_LIMIT_REPLENISH_PERIOD_MS)
        .const_burst_size(burst_size);
    let rate_limit_config = rate_limit_builder
        .finish()
        .expect("invalid rate-limit configuration");

    // Layers wrap routes that were registered *before* the .layer() call.
    // Order (outermost → innermost): CORS → rate-limit → prometheus → tracing → handler.
    // CORS must be outermost so preflight OPTIONS responses are never blocked
    // by the rate limiter. The prometheus middleware is inside rate-limiting so
    // that only non-throttled requests are measured.
    app.layer(prometheus_layer)
        .layer(TraceLayer::new_for_http())
        .layer(GovernorLayer::new(rate_limit_config))
        .layer(cors_layer())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_at_max_length_is_valid() {
        let key = "a".repeat(MAX_KEY_LENGTH);
        assert!(is_valid_key_length(&key));
    }

    #[test]
    fn key_exceeding_max_length_is_invalid() {
        let key = "a".repeat(MAX_KEY_LENGTH + 1);
        assert!(!is_valid_key_length(&key));
    }

    #[test]
    fn empty_key_is_valid() {
        assert!(is_valid_key_length(""));
    }
}
