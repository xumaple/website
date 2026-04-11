//! Backwards-compatibility tests for the permanent backcompat test user.
//!
//! These tests verify that a user created by `backcompat_setup.rs` can still
//! authenticate and retrieve their stored passwords. This guards against
//! breaking changes to auth, encryption, or data format.
//!
//! ## Prerequisites
//!
//! Run the setup once before these tests:
//!
//! ```sh
//! cargo test --test backcompat_setup -- --ignored --features test-helpers
//! ```
//!
//! ## Running
//!
//! ```sh
//! cargo test --test backcompat_tests --features test-helpers
//! ```

mod common;

use axum::body::Body;
use common::{app, body_string, parse_json, run, WithAuth};
use http::{Request, StatusCode};
use tower::ServiceExt;

// ── Expected values (must match backcompat_setup.rs) ────────────────────────

const BACKCOMPAT_USER: &str = "__backcompat_test_user__";
const BACKCOMPAT_PW: &str = "backcompat_password_123";

const EXPECTED_KEYS: &[&str] = &["email", "bank", "social"];

const EXPECTED_PASSWORDS: &[(&str, &str)] = &[
    ("email", "enc_email_value"),
    ("bank", "enc_bank_value"),
    ("social", "enc_social_value"),
];

// ── Tests ───────────────────────────────────────────────────────────────────

#[test]
fn test_backcompat_user_can_authenticate() {
    run(async {
        let req = Request::builder()
            .method("GET")
            .uri("/api/v2/user/verify")
            .auth(BACKCOMPAT_USER, BACKCOMPAT_PW)
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(
            res.status(),
            StatusCode::OK,
            "backcompat user should authenticate with known credentials"
        );
    });
}

#[test]
fn test_backcompat_user_keys_exist() {
    run(async {
        let req = Request::builder()
            .method("GET")
            .uri("/api/v2/keys")
            .auth(BACKCOMPAT_USER, BACKCOMPAT_PW)
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);

        let keys: Vec<String> = parse_json(&body_string(res).await);
        for expected_key in EXPECTED_KEYS {
            assert!(
                keys.contains(&(*expected_key).to_string()),
                "expected key '{expected_key}' not found in keys: {keys:?}"
            );
        }
    });
}

#[test]
fn test_backcompat_user_passwords_retrievable() {
    run(async {
        for (key, expected_value) in EXPECTED_PASSWORDS {
            let req = Request::builder()
                .method("GET")
                .uri(format!("/api/v2/passwords/{key}"))
                .auth(BACKCOMPAT_USER, BACKCOMPAT_PW)
                .body(Body::empty())
                .unwrap();
            let res = app().oneshot(req).await.unwrap();
            assert_eq!(
                res.status(),
                StatusCode::OK,
                "GET /passwords/{key} should succeed"
            );

            let value: String = parse_json(&body_string(res).await);
            assert_eq!(
                value, *expected_value,
                "password for key '{key}' does not match expected value"
            );
        }
    });
}
