pub mod db;
pub mod encrypt;
pub mod env;

use axum::{
    extract::{rejection::PathRejection, FromRequestParts, Path},
    http::{header::HeaderName, request::Parts, HeaderValue, Method, StatusCode},
    response::IntoResponse,
    routing::{get, post, put},
    Json, Router,
};
use axum_prometheus::metrics_exporter_prometheus::PrometheusHandle;
use axum_prometheus::PrometheusMetricLayer;
use db::{Bucket, DbError, Field};
use encrypt::{generate_password, Credentials, CryptoError};
use env::EnvVars;
use serde::Deserialize;
use std::sync::OnceLock;
use tower_governor::governor::GovernorConfigBuilder;
use tower_governor::GovernorLayer;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

const MAX_KEY_LENGTH: usize = 128;

/// The field label a v2 client's single stored value maps to. The v2 API
/// adapters read and write buckets exclusively through this label.
const PASSWORD_LABEL: &str = "password";

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

/// A bucket key name that has been validated for length.
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

/// A (bucket key, field label) path pair, each validated for length.
pub struct ValidatedKeyLabel(pub String, pub String);

impl<S> FromRequestParts<S> for ValidatedKeyLabel
where
    S: Send + Sync,
{
    type Rejection = Error;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let Path((key, label)) = Path::<(String, String)>::from_request_parts(parts, state)
            .await?;
        for part in [&key, &label] {
            if !is_valid_key_length(part) {
                return Err(Error::KeyTooLong(part.len()));
            }
        }
        Ok(ValidatedKeyLabel(key, label))
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
    #[error("Bucket has no field labeled {PASSWORD_LABEL:?}")]
    MissingPasswordField,
    #[error("v2 master-password change requires a password-only vault and a matching password count")]
    V2VaultShapeMismatch,
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

#[derive(Deserialize)]
pub struct UpdateUserV3Payload {
    pub new_password: String,
    pub buckets: Vec<Bucket>,
}

#[derive(Deserialize)]
pub struct RenameBucketPayload {
    pub new_key: String,
}

#[derive(Deserialize)]
pub struct FieldValuePayload {
    pub en_value: String,
    pub sensitive: bool,
}

// ---------------------------------------------------------------------------
// v2 <-> bucket mapping helpers
// ---------------------------------------------------------------------------

/// The bucket-native form of a v2 stored password: a single sensitive
/// "password"-labeled field.
fn password_field(en_value: String) -> Field {
    Field {
        label: PASSWORD_LABEL.to_owned(),
        en_value,
        sensitive: true,
    }
}

/// Extract the encrypted value of the "password"-labeled field, if any.
fn password_en_value(bucket: Bucket) -> Option<String> {
    bucket
        .fields
        .into_iter()
        .find(|f| f.label == PASSWORD_LABEL)
        .map(|f| f.en_value)
}

/// Map a v2 master-password-change payload onto bucket-native form.
///
/// A v2 client only knows about the single "password" value in each bucket
/// and can only re-encrypt those. If any bucket carries extra fields (created
/// by a v3 client), proceeding would leave those fields encrypted under the
/// old master password — corrupting the vault into two encryption keys — so
/// this refuses (`None`) unless every bucket has exactly one field labeled
/// "password" and the re-encrypted password count matches.
fn v2_reencrypted_buckets(stored: Vec<Bucket>, passwords: Vec<String>) -> Option<Vec<Bucket>> {
    if stored.len() != passwords.len() {
        return None;
    }
    if !stored
        .iter()
        .all(|b| b.fields.len() == 1 && b.fields[0].label == PASSWORD_LABEL)
    {
        return None;
    }
    Some(
        stored
            .into_iter()
            .zip(passwords)
            .map(|(b, en_value)| Bucket {
                key: b.key,
                fields: vec![password_field(en_value)],
            })
            .collect(),
    )
}

// ---------------------------------------------------------------------------
// Routes shared between v2 and v3
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

#[tracing::instrument(skip(creds))]
async fn get_keys(creds: Credentials) -> Result<Json<Vec<String>>, Error> {
    let keys = db::get_bucket_keys(creds).await?;
    tracing::info!("ok");
    Ok(Json(keys))
}

// ---------------------------------------------------------------------------
// v2 routes — thin adapters over the bucket model, preserving the old
// paths, payloads, and status codes.
// ---------------------------------------------------------------------------

#[tracing::instrument(skip(creds, payload))]
async fn update_user(
    creds: Credentials,
    Json(payload): Json<UpdateUserPayload>,
) -> Result<StatusCode, Error> {
    let stored = db::get_all_buckets(creds.clone()).await?;
    let new_buckets = v2_reencrypted_buckets(stored, payload.passwords)
        .ok_or(Error::V2VaultShapeMismatch)?;
    db::change_master_password(creds, payload.new_password, new_buckets).await?;
    tracing::info!("ok");
    Ok(StatusCode::OK)
}

#[tracing::instrument(skip(creds))]
async fn get_stored_password(
    creds: Credentials,
    ValidatedKey(key): ValidatedKey,
) -> Result<Json<String>, Error> {
    let bucket = db::get_bucket(creds, key).await?;
    let pw = password_en_value(bucket).ok_or(Error::MissingPasswordField)?;
    tracing::info!("ok");
    Ok(Json(pw))
}

#[tracing::instrument(skip(creds))]
async fn get_stored_passwords(creds: Credentials) -> Result<Json<Vec<String>>, Error> {
    let buckets = db::get_all_buckets(creds).await?;
    // Buckets without a "password"-labeled field are invisible to v2 clients.
    let pws: Vec<String> = buckets.into_iter().filter_map(password_en_value).collect();
    tracing::info!("ok");
    Ok(Json(pws))
}

#[tracing::instrument(skip(creds, payload))]
async fn add_stored_password(
    creds: Credentials,
    ValidatedKey(key): ValidatedKey,
    Json(payload): Json<PasswordPayload>,
) -> Result<StatusCode, Error> {
    db::create_bucket(creds, key, vec![password_field(payload.encrypted_password)]).await?;
    tracing::info!("ok");
    Ok(StatusCode::OK)
}

#[tracing::instrument(skip(creds, payload))]
async fn change_stored_password(
    creds: Credentials,
    ValidatedKey(key): ValidatedKey,
    Json(payload): Json<PasswordPayload>,
) -> Result<StatusCode, Error> {
    // upsert_field 404s if the bucket doesn't exist, matching the old
    // change_stored_password semantics (no implicit creation).
    db::upsert_field(creds, key, password_field(payload.encrypted_password)).await?;
    tracing::info!("ok");
    Ok(StatusCode::OK)
}

// ---------------------------------------------------------------------------
// v3 routes — bucket-native
// ---------------------------------------------------------------------------

#[tracing::instrument(skip(creds, payload))]
async fn update_user_v3(
    creds: Credentials,
    Json(payload): Json<UpdateUserV3Payload>,
) -> Result<StatusCode, Error> {
    db::change_master_password(creds, payload.new_password, payload.buckets).await?;
    tracing::info!("ok");
    Ok(StatusCode::OK)
}

#[tracing::instrument(skip(creds))]
async fn get_all_buckets(creds: Credentials) -> Result<Json<Vec<Bucket>>, Error> {
    let buckets = db::get_all_buckets(creds).await?;
    tracing::info!("ok");
    Ok(Json(buckets))
}

#[tracing::instrument(skip(creds))]
async fn get_bucket(
    creds: Credentials,
    ValidatedKey(key): ValidatedKey,
) -> Result<Json<Bucket>, Error> {
    let bucket = db::get_bucket(creds, key).await?;
    tracing::info!("ok");
    Ok(Json(bucket))
}

#[tracing::instrument(skip(creds, fields))]
async fn create_bucket(
    creds: Credentials,
    ValidatedKey(key): ValidatedKey,
    Json(fields): Json<Vec<Field>>,
) -> Result<StatusCode, Error> {
    // Labels arriving in the body bypass the path extractors' validation; an
    // over-long label would create a field the path-based field routes can
    // never address again.
    for field in &fields {
        if !is_valid_key_length(&field.label) {
            return Err(Error::KeyTooLong(field.label.len()));
        }
    }
    db::create_bucket(creds, key, fields).await?;
    tracing::info!("ok");
    Ok(StatusCode::OK)
}

#[tracing::instrument(skip(creds))]
async fn delete_bucket(
    creds: Credentials,
    ValidatedKey(key): ValidatedKey,
) -> Result<StatusCode, Error> {
    db::delete_bucket(creds, key).await?;
    tracing::info!("ok");
    Ok(StatusCode::OK)
}

#[tracing::instrument(skip(creds, payload))]
async fn rename_bucket(
    creds: Credentials,
    ValidatedKey(key): ValidatedKey,
    Json(payload): Json<RenameBucketPayload>,
) -> Result<StatusCode, Error> {
    let new_len = payload.new_key.len();
    if !is_valid_key_length(&payload.new_key) {
        return Err(Error::KeyTooLong(new_len));
    }
    db::rename_bucket(creds, key, payload.new_key).await?;
    tracing::info!("ok");
    Ok(StatusCode::OK)
}

#[tracing::instrument(skip(creds, payload))]
async fn upsert_field(
    creds: Credentials,
    ValidatedKeyLabel(key, label): ValidatedKeyLabel,
    Json(payload): Json<FieldValuePayload>,
) -> Result<StatusCode, Error> {
    db::upsert_field(
        creds,
        key,
        Field {
            label,
            en_value: payload.en_value,
            sensitive: payload.sensitive,
        },
    )
    .await?;
    tracing::info!("ok");
    Ok(StatusCode::OK)
}

#[tracing::instrument(skip(creds))]
async fn delete_field(
    creds: Credentials,
    ValidatedKeyLabel(key, label): ValidatedKeyLabel,
) -> Result<StatusCode, Error> {
    db::delete_field(creds, key, label).await?;
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
        // v2 — legacy password-only API, served as adapters over buckets.
        .route("/api/v2/generate", get(generate))
        .route("/api/v2/user", post(create_user).put(update_user))
        .route("/api/v2/user/verify", get(verify_user))
        .route("/api/v2/keys", get(get_keys))
        .route(
            "/api/v2/passwords/{key}",
            get(get_stored_password)
                .post(add_stored_password)
                .put(change_stored_password),
        )
        .route("/api/v2/passwords", get(get_stored_passwords))
        // v3 — bucket-native API.
        .route("/api/v3/generate", get(generate))
        .route("/api/v3/user", post(create_user).put(update_user_v3))
        .route("/api/v3/user/verify", get(verify_user))
        .route("/api/v3/buckets", get(get_keys))
        .route("/api/v3/buckets/all", get(get_all_buckets))
        .route(
            "/api/v3/bucket/{key}",
            get(get_bucket).post(create_bucket).delete(delete_bucket),
        )
        .route("/api/v3/bucket/{key}/rename", post(rename_bucket))
        .route(
            "/api/v3/bucket/{key}/field/{label}",
            put(upsert_field).delete(delete_field),
        )
        .route("/", get(root));

    #[cfg(any(test, debug_assertions, feature = "test-helpers"))]
    let app = app
        .route("/api/v2/user", axum::routing::delete(delete_user))
        .route("/api/v3/user", axum::routing::delete(delete_user));

    app
}

/// Build the application [`Router`] with middleware configured via [`RouterConfig`].
///
/// Safe to call multiple times — the Prometheus recorder is initialised once
/// and reused.
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

    // .layer() is last-added = outermost; read bottom-to-top for execution order.
    app.layer(prometheus_layer)
        .layer(TraceLayer::new_for_http())
        .layer(GovernorLayer::new(rate_limit_config))
        .layer(cors_layer())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn field(label: &str, en_value: &str, sensitive: bool) -> Field {
        Field {
            label: label.to_string(),
            en_value: en_value.to_string(),
            sensitive,
        }
    }

    fn bucket(key: &str, fields: Vec<Field>) -> Bucket {
        Bucket {
            key: key.to_string(),
            fields,
        }
    }

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

    #[test]
    fn password_field_is_sensitive_password_label() {
        let f = password_field("cipher".to_string());
        assert_eq!(f.label, PASSWORD_LABEL);
        assert_eq!(f.en_value, "cipher");
        assert!(f.sensitive);
    }

    #[test]
    fn password_en_value_finds_password_field() {
        let b = bucket(
            "gmail",
            vec![
                field("email", "enc_email", false),
                field("password", "enc_pw", true),
            ],
        );
        assert_eq!(password_en_value(b), Some("enc_pw".to_string()));
    }

    #[test]
    fn password_en_value_none_when_absent() {
        let b = bucket("gmail", vec![field("email", "enc_email", false)]);
        assert_eq!(password_en_value(b), None);

        let empty = bucket("empty", vec![]);
        assert_eq!(password_en_value(empty), None);
    }

    #[test]
    fn v2_reencrypted_buckets_maps_password_only_vault() {
        let stored = vec![
            bucket("gmail", vec![field("password", "old1", true)]),
            bucket("github", vec![field("password", "old2", true)]),
        ];
        let new = v2_reencrypted_buckets(stored, vec!["new1".into(), "new2".into()]).unwrap();

        assert_eq!(new.len(), 2);
        assert_eq!(new[0].key, "gmail");
        assert_eq!(new[0].fields.len(), 1);
        assert_eq!(new[0].fields[0].en_value, "new1");
        assert!(new[0].fields[0].sensitive);
        assert_eq!(new[1].key, "github");
        assert_eq!(new[1].fields[0].en_value, "new2");
    }

    #[test]
    fn v2_reencrypted_buckets_empty_vault_ok() {
        assert!(v2_reencrypted_buckets(vec![], vec![]).unwrap().is_empty());
    }

    #[test]
    fn v2_reencrypted_buckets_rejects_count_mismatch() {
        let stored = vec![bucket("gmail", vec![field("password", "old", true)])];
        assert!(v2_reencrypted_buckets(stored.clone(), vec![]).is_none());
        assert!(v2_reencrypted_buckets(stored, vec!["a".into(), "b".into()]).is_none());
    }

    #[test]
    fn v2_reencrypted_buckets_rejects_multi_field_bucket() {
        // A v3 client added an extra field; a v2 client can't re-encrypt it.
        let stored = vec![bucket(
            "gmail",
            vec![
                field("password", "old", true),
                field("email", "enc_email", false),
            ],
        )];
        assert!(v2_reencrypted_buckets(stored, vec!["new".into()]).is_none());
    }

    #[test]
    fn v2_reencrypted_buckets_rejects_non_password_single_field() {
        let stored = vec![bucket("gmail", vec![field("email", "enc_email", false)])];
        assert!(v2_reencrypted_buckets(stored, vec!["new".into()]).is_none());
    }
}
