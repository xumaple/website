//! Concurrency tests for the MapoPass API.
//!
//! Verifies that per-user locking serializes concurrent mutations correctly.
//!
//! ## Running
//!
//! ```sh
//! # From passwords/api/:
//! cargo test --test concurrency_tests --features test-helpers
//! ```

mod common;

use axum::body::Body;
use common::{app, body_string, parse_json, run, TestUser, WithAuth};
use http::{Request, StatusCode};
use std::sync::Arc;
use tower::ServiceExt;

#[test]
fn test_concurrent_password_adds_are_serialized() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        // Create user
        let req = Request::builder()
            .method("POST")
            .uri("/api/v2/user")
            .auth(user, pw)
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK, "create user");

        // Fire N concurrent add-password requests with distinct keys
        let n = 10;
        let user = Arc::new(user.to_string());
        let pw = Arc::new(pw.to_string());

        let mut handles = Vec::with_capacity(n);
        for i in 0..n {
            let user = Arc::clone(&user);
            let pw = Arc::clone(&pw);
            let handle = tokio::spawn(async move {
                let key = format!("concurrent_key_{i}");
                let val = format!("enc_val_{i}");
                let req = Request::builder()
                    .method("POST")
                    .uri(format!("/api/v2/passwords/{key}"))
                    .header("x-username", user.as_str())
                    .header("x-password", pw.as_str())
                    .header("content-type", "application/json")
                    .body(Body::from(format!(r#"{{"encrypted_password":"{val}"}}"#)))
                    .unwrap();
                let res = app().oneshot(req).await.unwrap();
                assert_eq!(
                    res.status(),
                    StatusCode::OK,
                    "concurrent add key {key} failed"
                );
            });
            handles.push(handle);
        }

        for h in handles {
            h.await.expect("task panicked");
        }

        // Verify all N keys are present
        let req = Request::builder()
            .method("GET")
            .uri("/api/v2/keys")
            .header("x-username", user.as_str())
            .header("x-password", pw.as_str())
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let keys: Vec<String> = parse_json(&body_string(res).await);
        assert_eq!(
            keys.len(),
            n,
            "expected {n} keys after concurrent adds, got {}: {keys:?}",
            keys.len()
        );
    });
}
