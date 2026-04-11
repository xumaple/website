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
use tokio::sync::Barrier;
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

/// Exposes a TOCTOU bug: two requests both authenticate with the current
/// password *before* either acquires the per-user lock, so the second one
/// succeeds with stale credentials that should have been invalidated by
/// the first request's password change.
#[test]
fn test_stale_credentials_rejected_after_concurrent_master_password_change() {
    run(async {
        let pw1 = "original_password";
        let pw2 = "changed_to_pw2";
        let pw3 = "changed_to_pw3";

        // --- Setup: create user with pw1 and add one stored password ---
        let t = TestUser::new();
        let user = t.user().to_string();

        let req = Request::builder()
            .method("POST")
            .uri("/api/v2/user")
            .auth(&user, pw1)
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK, "create user");

        let req = Request::builder()
            .method("POST")
            .uri("/api/v2/passwords/site1")
            .auth(&user, pw1)
            .header("content-type", "application/json")
            .body(Body::from(r#"{"encrypted_password":"enc_value_1"}"#))
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK, "add stored password");

        // --- Fire two concurrent change-master-password requests ---
        // Both authenticate with pw1 (current). Request A changes to pw2,
        // request B changes to pw3. The barrier ensures both tasks reach
        // the request point before either one completes, maximizing the
        // window for both to pass authentication before the lock is acquired.
        let barrier = Arc::new(Barrier::new(2));
        let user_a = user.clone();
        let barrier_a = Arc::clone(&barrier);
        let handle_a = tokio::spawn(async move {
            barrier_a.wait().await;
            let req = Request::builder()
                .method("PUT")
                .uri("/api/v2/user")
                .auth(&user_a, pw1)
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"new_password":"{pw2}","passwords":["reenc_a"]}}"#
                )))
                .unwrap();
            app().oneshot(req).await.unwrap()
        });

        let user_b = user.clone();
        let barrier_b = Arc::clone(&barrier);
        let handle_b = tokio::spawn(async move {
            barrier_b.wait().await;
            let req = Request::builder()
                .method("PUT")
                .uri("/api/v2/user")
                .auth(&user_b, pw1)
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"new_password":"{pw3}","passwords":["reenc_b"]}}"#
                )))
                .unwrap();
            app().oneshot(req).await.unwrap()
        });

        let res_a = handle_a.await.expect("task A panicked");
        let res_b = handle_b.await.expect("task B panicked");

        let status_a = res_a.status();
        let status_b = res_b.status();

        // Exactly one should succeed and one should fail. The second request
        // to acquire the lock should discover that pw1 is no longer valid
        // (the first request changed it) and return 404.
        let (ok_count, fail_count) = [status_a, status_b]
            .iter()
            .fold((0u32, 0u32), |(ok, fail), s| {
                if *s == StatusCode::OK {
                    (ok + 1, fail)
                } else {
                    assert_eq!(
                        *s,
                        StatusCode::NOT_FOUND,
                        "failing request should return 404, got {s}"
                    );
                    (ok, fail + 1)
                }
            });

        assert_eq!(
            ok_count, 1,
            "expected exactly 1 success, got {ok_count} (A={status_a}, B={status_b})"
        );
        assert_eq!(
            fail_count, 1,
            "expected exactly 1 failure, got {fail_count} (A={status_a}, B={status_b})"
        );

        // --- Verify final state is consistent ---
        // The winning password (pw2 or pw3) should work; the other should not.
        // pw1 should definitely not work anymore.
        let winning_pw = if status_a == StatusCode::OK {
            pw2
        } else {
            pw3
        };
        let losing_pw = if status_a == StatusCode::OK {
            pw3
        } else {
            pw2
        };

        // Winner's password works
        let req = Request::builder()
            .method("GET")
            .uri("/api/v2/user/verify")
            .auth(&user, winning_pw)
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(
            res.status(),
            StatusCode::OK,
            "winning password should verify"
        );

        // Loser's password does not work
        let req = Request::builder()
            .method("GET")
            .uri("/api/v2/user/verify")
            .auth(&user, losing_pw)
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(
            res.status(),
            StatusCode::NOT_FOUND,
            "losing password should not verify"
        );

        // Original password (pw1) does not work
        let req = Request::builder()
            .method("GET")
            .uri("/api/v2/user/verify")
            .auth(&user, pw1)
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(
            res.status(),
            StatusCode::NOT_FOUND,
            "original password should not verify after master change"
        );

        // Clean up: update TestUser's password so Drop can delete with correct creds
        // (TestUser::drop uses the original password, but we changed it)
        // Actually, TestUser::drop calls db::delete_user which takes just the username,
        // so cleanup will work regardless.
    });
}

/// Verifies that add_stored_password rejects stale credentials after a
/// concurrent master password change. Thread A changes the master password,
/// thread B tries to add a password using the old (now-invalid) credentials.
/// Thread B should fail because its pre-auth credentials are stale.
#[test]
fn test_stale_credentials_rejected_on_add_password_after_master_change() {
    run(async {
        let pw_old = "original_password";
        let pw_new = "new_password";

        // --- Setup: create user with pw_old ---
        let t = TestUser::new();
        let user = t.user().to_string();

        let req = Request::builder()
            .method("POST")
            .uri("/api/v2/user")
            .auth(&user, pw_old)
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK, "create user");

        // --- Fire two concurrent requests ---
        // A: change master password (pw_old -> pw_new)
        // B: add a stored password using pw_old
        // Both authenticate with pw_old before either acquires the lock.
        let barrier = Arc::new(Barrier::new(2));

        let user_a = user.clone();
        let barrier_a = Arc::clone(&barrier);
        let handle_a = tokio::spawn(async move {
            barrier_a.wait().await;
            let req = Request::builder()
                .method("PUT")
                .uri("/api/v2/user")
                .auth(&user_a, pw_old)
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"new_password":"{pw_new}","passwords":[]}}"#
                )))
                .unwrap();
            app().oneshot(req).await.unwrap()
        });

        let user_b = user.clone();
        let barrier_b = Arc::clone(&barrier);
        let handle_b = tokio::spawn(async move {
            barrier_b.wait().await;
            let req = Request::builder()
                .method("POST")
                .uri("/api/v2/passwords/sneaky_key")
                .auth(&user_b, pw_old)
                .header("content-type", "application/json")
                .body(Body::from(r#"{"encrypted_password":"enc_val"}"#))
                .unwrap();
            app().oneshot(req).await.unwrap()
        });

        let res_a = handle_a.await.expect("task A panicked");
        let res_b = handle_b.await.expect("task B panicked");

        let status_a = res_a.status();
        let status_b = res_b.status();

        // If the master password change wins the lock first, the add-password
        // request should be rejected because its credentials are stale.
        // If add-password wins the lock first, both succeed (add happens
        // before the password changes, and change_master_password re-encrypts
        // all passwords including the newly added one — though the test sends
        // an empty passwords array, so the change would fail on count mismatch).
        //
        // In either ordering, at most one can succeed. If A wins the lock:
        //   A succeeds, B should fail (stale creds).
        // If B wins the lock:
        //   B succeeds (adds password), A fails (count mismatch: 1 stored vs 0 sent).
        // Either way: exactly one success.
        let ok_count = [status_a, status_b]
            .iter()
            .filter(|s| **s == StatusCode::OK)
            .count();
        let fail_count = [status_a, status_b]
            .iter()
            .filter(|s| **s == StatusCode::NOT_FOUND)
            .count();

        assert_eq!(
            ok_count, 1,
            "expected exactly 1 success, got {ok_count} (A={status_a}, B={status_b})"
        );
        assert_eq!(
            fail_count, 1,
            "expected exactly 1 failure, got {fail_count} (A={status_a}, B={status_b})"
        );
    });
}
