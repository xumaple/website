//! One-time setup for the backwards-compatibility test user.
//!
//! This test is `#[ignore]`d so it only runs when explicitly requested:
//!
//! ```sh
//! cargo test --test backcompat_setup -- --ignored --features test-helpers
//! ```
//!
//! It creates a permanent user with known credentials and stored passwords.
//! If the user already exists (duplicate → 404 under uniform error policy),
//! the test succeeds gracefully.

mod common;

use axum::body::Body;
use common::backcompat::{BACKCOMPAT_PW, BACKCOMPAT_USER, OLD_RAW_USER, EXPECTED_PASSWORDS};
use common::{app, body_string, run, WithAuth};
use http::{Request, StatusCode};
use tower::ServiceExt;

#[test]
#[ignore]
fn setup_backcompat_user() {
    run(async {
        // 0. Clean up the old broken user that was created with the raw
        //    (unhashed) username. Ignore errors — the user may not exist.
        let req = Request::builder()
            .method("DELETE")
            .uri("/api/v2/user")
            .header("x-username", OLD_RAW_USER)
            .header("x-password", "unused")
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        eprintln!(
            "Old user cleanup: status {}",
            res.status()
        );

        // 1. Create the user with hashed credentials (as the frontend would
        //    send after `encryptMaster()`). If it already exists the API
        //    returns 404 (uniform error responses), which we treat as success.
        let req = Request::builder()
            .method("POST")
            .uri("/api/v2/user")
            .auth(BACKCOMPAT_USER, BACKCOMPAT_PW)
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        let status = res.status();
        let body = body_string(res).await;
        match status {
            StatusCode::OK => eprintln!("Created backcompat user"),
            StatusCode::NOT_FOUND => {
                eprintln!("Backcompat user already exists (got 404): {body}");
            }
            other => panic!("Unexpected status {other} creating backcompat user: {body}"),
        }

        // 2. Verify we can authenticate as the backcompat user.
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
            "backcompat user must be verifiable after creation"
        );

        // 3. Add stored passwords with AES-encrypted values (encrypted with
        //    SHA-256 of the plaintext password as key). If a key already
        //    exists the API returns 404 (duplicate key → uniform error),
        //    which we skip gracefully.
        for (key, enc_pw) in EXPECTED_PASSWORDS {
            let req = Request::builder()
                .method("POST")
                .uri(format!("/api/v2/passwords/{key}"))
                .auth(BACKCOMPAT_USER, BACKCOMPAT_PW)
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"encrypted_password":"{enc_pw}"}}"#
                )))
                .unwrap();
            let res = app().oneshot(req).await.unwrap();
            let status = res.status();
            match status {
                StatusCode::OK => eprintln!("Added key '{key}'"),
                StatusCode::NOT_FOUND => {
                    eprintln!("Key '{key}' already exists (got 404), skipping");
                }
                other => {
                    let body = body_string(res).await;
                    panic!("Unexpected status {other} adding key '{key}': {body}");
                }
            }
        }

        eprintln!("Backcompat setup complete.");
    });
}
