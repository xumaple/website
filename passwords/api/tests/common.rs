//! Shared test infrastructure for integration tests.
//!
//! Provides a shared tokio runtime, Axum router, RAII test user cleanup,
//! and common helpers. Import via `mod common;` from any test file.

// Each test binary compiles this module independently and may not use every
// item. Suppress dead-code warnings that arise from partial usage.
#![allow(dead_code)]

use axum::body::Body;
use axum::{Router, middleware::from_fn, extract::ConnectInfo};
use http::Request;
use mongodb::bson::oid::ObjectId;
use passwords::{build_router, RouterConfig};
use passwords::db;
use std::net::SocketAddr;
use std::sync::LazyLock;

pub const TEST_PW: &str = "test_password_abc123";

// ── Backcompat test constants ──────────────────────────────────────────────
// Shared between backcompat_setup.rs and backcompat_tests.rs.

pub mod backcompat {
    /// Plaintext credentials — used by e2e tests that log in through the UI.
    pub const BACKCOMPAT_PLAINTEXT_USER: &str = "backcompat_test_user";
    pub const BACKCOMPAT_PLAINTEXT_PW: &str = "backcompat_password_123";

    /// Client-side SHA-3 hashed credentials (output of `encryptMaster()`).
    /// These are what the frontend sends as `x-username` / `x-password` headers.
    pub const BACKCOMPAT_USER: &str = "93aba7f07aa6cd38";
    pub const BACKCOMPAT_PW: &str = "e6c146a2e22f5e2e";

    /// The old raw username used by the previous (broken) backcompat user.
    /// Used only for cleanup in `backcompat_setup.rs`.
    pub const OLD_RAW_USER: &str = "__backcompat_test_user__";

    pub const EXPECTED_KEYS: &[&str] = &["email", "bank", "social"];

    /// Encrypted password values (AES with SHA-256 of the plaintext password as key).
    pub const EXPECTED_PASSWORDS: &[(&str, &str)] = &[
        ("email", "U2FsdGVkX184eJIaOi3wqeiw22+VTItwS6ujyQjQl6yr6kSW9UKrtq5sFLoCe7aD"),
        ("bank", "U2FsdGVkX19Szi+RIYAHWUjHPgLM3EKL43CrEJB8zyfb2GY6u+Pn4dw/3uSMeZQk"),
        ("social", "U2FsdGVkX1/0UvpMeilf4CXaAppupUSgA6di9fjBv26F1pdUyPLJiJmQTMdx6n4K"),
    ];
}

// ---------------------------------------------------------------------------
// Single shared runtime – keeps the MongoDB connection pool alive across tests.
// Shared Axum router + DB connection (initialized once on the shared runtime).
// ---------------------------------------------------------------------------

pub static RT: LazyLock<tokio::runtime::Runtime> = LazyLock::new(|| {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("Failed to create shared tokio runtime")
});

static APP: LazyLock<Router> = LazyLock::new(|| {
    RT.block_on(async {
        dotenv::dotenv().ok();
        db::connect().await.expect("Failed to connect to test DB");
        // use a very large burst so ordinary tests aren't disrupted by our
        // rate limiter; stress test will create its own router below.
        build_router(RouterConfig { burst_size: 1_000_000 })
    })
});

/// Returns a fresh clone of the shared router (needed because `oneshot` consumes the service).
pub fn app() -> Router {
    // For tests we never run a real TCP server, so the GovernorLayer's default
    // PeerIpKeyExtractor would fail to extract a peer IP (leading to 500
    // errors).  Inject a dummy ConnectInfo using middleware so the rate limiter
    // sees a valid address on every request.
    let addr = SocketAddr::from(([127, 0, 0, 1], 0));
    APP.clone().layer(from_fn(move |mut req: Request<Body>, next: axum::middleware::Next| async move {
        req.extensions_mut().insert(ConnectInfo(addr));
        next.run(req).await
    }))
}

// ---------------------------------------------------------------------------
// WithAuth: extension trait for attaching credentials to test requests.
// ---------------------------------------------------------------------------

pub trait WithAuth {
    fn auth(self, user: &str, pw: &str) -> Self;
}

impl WithAuth for http::request::Builder {
    fn auth(self, user: &str, pw: &str) -> Self {
        self.header("x-username", user)
            .header("x-password", pw)
    }
}

// ---------------------------------------------------------------------------
// TestUser: RAII guard that generates a unique username and deletes it on drop.
// ---------------------------------------------------------------------------

pub struct TestUser {
    username: String,
    password: String,
}

impl Default for TestUser {
    fn default() -> Self {
        Self::new()
    }
}

impl TestUser {
    pub fn new() -> Self {
        Self {
            username: format!("__test_{}__", ObjectId::new().to_hex()),
            password: TEST_PW.to_string(),
        }
    }

    pub fn user(&self) -> &str {
        &self.username
    }

    pub fn pw(&self) -> &str {
        &self.password
    }
}

impl Drop for TestUser {
    fn drop(&mut self) {
        let username = self.username.clone();
        let handle = RT.handle().clone();
        // Spawn a separate OS thread so we can block_on without nesting inside
        // the RT.block_on() that is driving the test body.
        std::thread::spawn(move || {
            handle.block_on(async {
                let _ = db::delete_user(username).await;
            });
        })
        .join()
        .ok();
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

pub fn parse_json<T: serde::de::DeserializeOwned>(body: &str) -> T {
    serde_json::from_str(body).expect("Failed to parse JSON response")
}

/// Read the full response body as a String.
pub async fn body_string(res: axum::response::Response) -> String {
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .expect("Failed to read response body");
    String::from_utf8(bytes.to_vec()).expect("Response body is not valid UTF-8")
}

/// Run an async test body on the shared runtime.
/// Ensures the app (and DB) is initialized before entering the runtime.
pub fn run<F: std::future::Future>(f: F) -> F::Output {
    // Trigger app initialization BEFORE entering block_on, to avoid nested
    // block_on calls (APP's LazyLock uses RT.block_on internally).
    let _ = app();
    RT.block_on(f)
}
