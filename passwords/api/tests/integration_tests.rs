//! Integration tests for the MapoPass API.
//!
//! These tests exercise the Axum HTTP routes end-to-end against a real
//! MongoDB instance (configured via `.env`). They use Axum's in-process
//! `Router` with `tower::ServiceExt::oneshot` so no actual TCP port is opened.
//!
//! ## Running
//!
//! ```sh
//! # From passwords/api/:
//! cargo test --test integration_tests --features test-helpers
//! ```

mod common;

use axum::body::Body;
use axum::{middleware::from_fn, extract::ConnectInfo};
use common::{app, body_string, parse_json, run, TestUser, WithAuth};
use http::{Request, StatusCode};
use passwords::build_router_with_burst_no_metrics;
use std::net::SocketAddr;
use std::time::Duration;
use tower::ServiceExt;

// ===========================================================================
// Tests
// ===========================================================================

// ── Smoke tests ────────────────────────────────────────────────────────────

#[test]
fn test_root() {
    run(async {
        let req = Request::builder()
            .method("GET")
            .uri("/")
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(body_string(res).await, "Don't get hacked");
    });
}

#[test]
fn test_generate_password() {
    run(async {
        let req = Request::builder()
            .method("GET")
            .uri("/api/v2/generate")
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let pw: String = parse_json(&body_string(res).await);
        assert_eq!(pw.len(), 15); // PASSWORD_LEN
    });
}

// Simple stress test to ensure the global rate limiter is enforcing the
// configured burst size. We hit the `/generate` endpoint repeatedly and
// expect at least one 429 Too Many Requests once the burst threshold is
// exceeded. A brief sleep afterward ensures tokens replenish for later
// tests.
#[test]
fn test_rate_limiting() {
    run(async {
        // Build a fresh router using the default burst size so we can actually
        // observe throttling.  We still need the connect-info middleware that
        // `app()` adds, so copy that behaviour.
        let addr = SocketAddr::from(([127, 0, 0, 1], 0));
        let limited = build_router_with_burst_no_metrics(10)
            .layer(from_fn(move |mut req: Request<Body>, next: axum::middleware::Next| async move {
                req.extensions_mut().insert(ConnectInfo(addr));
                next.run(req).await
            }));

        let mut saw_429 = false;
        for _ in 0..20 {
            let req = Request::builder()
                .method("GET")
                .uri("/api/v2/generate")
                .body(Body::empty())
                .unwrap();
            let res = limited.clone().oneshot(req).await.unwrap();
            if res.status() == StatusCode::TOO_MANY_REQUESTS {
                saw_429 = true;
                break;
            }
        }
        assert!(saw_429, "expected at least one 429 after burst of requests");

        // ensure the limiter has time to replenish so other tests (if any) aren't
        // affected.
        tokio::time::sleep(Duration::from_millis(200)).await;
    });
}

// ── Happy-path lifecycle ─────────────────────────────────────────────────

#[test]
fn test_full_user_lifecycle() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        // 1. Create user
        let req = Request::builder()
            .method("POST")
            .uri("/api/v2/user")
            .auth(user, pw)
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK, "create user");

        // 2. Verify user
        let req = Request::builder()
            .method("GET")
            .uri("/api/v2/user/verify")
            .auth(user, pw)
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK, "verify user");

        // 3. Wrong password → 404
        let req = Request::builder()
            .method("GET")
            .uri("/api/v2/user/verify")
            .auth(user, "wrong")
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "wrong password");

        // 4. Keys should be empty
        let req = Request::builder()
            .method("GET")
            .uri("/api/v2/keys")
            .auth(user, pw)
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let keys: Vec<String> = parse_json(&body_string(res).await);
        assert!(keys.is_empty(), "new user has no keys");

        // 5. Add passwords
        for (key, val) in [("gmail", "enc_gmail"), ("github", "enc_github")] {
            let req = Request::builder()
                .method("POST")
                .uri(format!("/api/v2/passwords/{key}"))
                .auth(user, pw)
                .header("content-type", "application/json")
                .body(Body::from(format!(r#"{{"encrypted_password":"{val}"}}"#)))
                .unwrap();
            let res = app().oneshot(req).await.unwrap();
            assert_eq!(res.status(), StatusCode::OK, "add {key}");
        }

        // 6. Keys should have 2
        let req = Request::builder()
            .method("GET")
            .uri("/api/v2/keys")
            .auth(user, pw)
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        let keys: Vec<String> = parse_json(&body_string(res).await);
        assert_eq!(keys.len(), 2);
        assert!(keys.contains(&"gmail".into()));
        assert!(keys.contains(&"github".into()));

        // 7. Get individual password
        let req = Request::builder()
            .method("GET")
            .uri("/api/v2/passwords/gmail")
            .auth(user, pw)
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(
            parse_json::<String>(&body_string(res).await),
            "enc_gmail"
        );

        // 8. Get all passwords
        let req = Request::builder()
            .method("GET")
            .uri("/api/v2/passwords")
            .auth(user, pw)
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        let all: Vec<String> = parse_json(&body_string(res).await);
        assert_eq!(all.len(), 2);

        // 9. Change a stored password
        let req = Request::builder()
            .method("PUT")
            .uri("/api/v2/passwords/gmail")
            .auth(user, pw)
            .header("content-type", "application/json")
            .body(Body::from(r#"{"encrypted_password":"new_gmail"}"#))
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK, "change stored pw");

        let req = Request::builder()
            .method("GET")
            .uri("/api/v2/passwords/gmail")
            .auth(user, pw)
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(
            parse_json::<String>(&body_string(res).await),
            "new_gmail"
        );

        // 10. Change master password
        let new_pw = "new_master_password_xyz";
        let req = Request::builder()
            .method("PUT")
            .uri("/api/v2/user")
            .auth(user, pw)
            .header("content-type", "application/json")
            .body(Body::from(format!(
                r#"{{"new_password":"{new_pw}","passwords":["reenc_gmail","reenc_github"]}}"#
            )))
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK, "change master");

        // 11. Old password fails
        let req = Request::builder()
            .method("GET")
            .uri("/api/v2/user/verify")
            .auth(user, pw)
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "old pw rejected");

        // 12. New password works
        let req = Request::builder()
            .method("GET")
            .uri("/api/v2/user/verify")
            .auth(user, new_pw)
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK, "new pw accepted");

        // 13. Passwords re-encrypted
        let req = Request::builder()
            .method("GET")
            .uri("/api/v2/passwords/gmail")
            .auth(user, new_pw)
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(
            parse_json::<String>(&body_string(res).await),
            "reenc_gmail"
        );
    });
}

// ── Error / edge-case tests ──────────────────────────────────────────────

#[test]
fn test_duplicate_user_rejected() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        let req = Request::builder()
            .method("POST")
            .uri("/api/v2/user")
            .auth(user, pw)
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);

        let req = Request::builder()
            .method("POST")
            .uri("/api/v2/user")
            .auth(user, pw)
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "duplicate user rejected");
    });
}

#[test]
fn test_duplicate_key_rejected() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        let req = Request::builder()
            .method("POST")
            .uri("/api/v2/user")
            .auth(user, pw)
            .body(Body::empty())
            .unwrap();
        app().oneshot(req).await.unwrap();

        let req = Request::builder()
            .method("POST")
            .uri("/api/v2/passwords/mykey")
            .auth(user, pw)
            .header("content-type", "application/json")
            .body(Body::from(r#"{"encrypted_password":"v1"}"#))
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);

        let req = Request::builder()
            .method("POST")
            .uri("/api/v2/passwords/mykey")
            .auth(user, pw)
            .header("content-type", "application/json")
            .body(Body::from(r#"{"encrypted_password":"v2"}"#))
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "duplicate key rejected");
    });
}

#[test]
fn test_nonexistent_key_returns_error() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        let req = Request::builder()
            .method("POST")
            .uri("/api/v2/user")
            .auth(user, pw)
            .body(Body::empty())
            .unwrap();
        app().oneshot(req).await.unwrap();

        let req = Request::builder()
            .method("GET")
            .uri("/api/v2/passwords/bogus")
            .auth(user, pw)
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "nonexistent key → 404");
    });
}

#[test]
fn test_change_master_password_mismatched_count() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        let req = Request::builder()
            .method("POST")
            .uri("/api/v2/user")
            .auth(user, pw)
            .body(Body::empty())
            .unwrap();
        app().oneshot(req).await.unwrap();

        let req = Request::builder()
            .method("POST")
            .uri("/api/v2/passwords/site")
            .auth(user, pw)
            .header("content-type", "application/json")
            .body(Body::from(r#"{"encrypted_password":"enc"}"#))
            .unwrap();
        app().oneshot(req).await.unwrap();

        // 0 re-encrypted passwords instead of 1
        let req = Request::builder()
            .method("PUT")
            .uri("/api/v2/user")
            .auth(user, pw)
            .header("content-type", "application/json")
            .body(Body::from(r#"{"new_password":"newpw","passwords":[]}"#))
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(
            res.status(),
            StatusCode::NOT_FOUND,
            "mismatched count rejected"
        );
    });
}

#[test]
fn test_nonexistent_user_verify() {
    run(async {
        let t = TestUser::new();
        // Never create the user — all ops should fail
        let (user, pw) = (t.user(), t.pw());

        let req = Request::builder()
            .method("GET")
            .uri("/api/v2/user/verify")
            .auth(user, pw)
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "verify nonexistent user");
    });
}

#[test]
fn test_nonexistent_user_get_keys() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        let req = Request::builder()
            .method("GET")
            .uri("/api/v2/keys")
            .auth(user, pw)
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "getkeys nonexistent user");
    });
}

#[test]
fn test_wrong_password_on_add_stored_password() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        let req = Request::builder()
            .method("POST")
            .uri("/api/v2/user")
            .auth(user, pw)
            .body(Body::empty())
            .unwrap();
        app().oneshot(req).await.unwrap();

        let req = Request::builder()
            .method("POST")
            .uri("/api/v2/passwords/key1")
            .auth(user, "wrongpw")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"encrypted_password":"v1"}"#))
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "wrong pw on add stored pw");
    });
}

#[test]
fn test_wrong_password_on_change_stored_password() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        let req = Request::builder()
            .method("POST")
            .uri("/api/v2/user")
            .auth(user, pw)
            .body(Body::empty())
            .unwrap();
        app().oneshot(req).await.unwrap();

        let req = Request::builder()
            .method("POST")
            .uri("/api/v2/passwords/key1")
            .auth(user, pw)
            .header("content-type", "application/json")
            .body(Body::from(r#"{"encrypted_password":"v1"}"#))
            .unwrap();
        app().oneshot(req).await.unwrap();

        let req = Request::builder()
            .method("PUT")
            .uri("/api/v2/passwords/key1")
            .auth(user, "wrongpw")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"encrypted_password":"v2"}"#))
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "wrong pw on change stored pw");
    });
}

#[test]
fn test_wrong_password_on_change_master() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        let req = Request::builder()
            .method("POST")
            .uri("/api/v2/user")
            .auth(user, pw)
            .body(Body::empty())
            .unwrap();
        app().oneshot(req).await.unwrap();

        let req = Request::builder()
            .method("PUT")
            .uri("/api/v2/user")
            .auth(user, "wrongpw")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"new_password":"newpw","passwords":[]}"#))
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "wrong pw on change master");
    });
}

#[test]
fn test_change_nonexistent_stored_password_key() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        let req = Request::builder()
            .method("POST")
            .uri("/api/v2/user")
            .auth(user, pw)
            .body(Body::empty())
            .unwrap();
        app().oneshot(req).await.unwrap();

        let req = Request::builder()
            .method("PUT")
            .uri("/api/v2/passwords/nokey")
            .auth(user, pw)
            .header("content-type", "application/json")
            .body(Body::from(r#"{"encrypted_password":"v"}"#))
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "change nonexistent key");
    });
}

#[test]
fn test_get_passwords_empty() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        let req = Request::builder()
            .method("POST")
            .uri("/api/v2/user")
            .auth(user, pw)
            .body(Body::empty())
            .unwrap();
        app().oneshot(req).await.unwrap();

        // getpws on user with no stored passwords
        let req = Request::builder()
            .method("GET")
            .uri("/api/v2/passwords")
            .auth(user, pw)
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let pws: Vec<String> = parse_json(&body_string(res).await);
        assert!(pws.is_empty(), "new user has no passwords");
    });
}

#[test]
fn test_generated_passwords_are_unique() {
    run(async {
        let req1 = Request::builder()
            .method("GET")
            .uri("/api/v2/generate")
            .body(Body::empty())
            .unwrap();
        let req2 = Request::builder()
            .method("GET")
            .uri("/api/v2/generate")
            .body(Body::empty())
            .unwrap();
        let res1 = app().oneshot(req1).await.unwrap();
        let res2 = app().oneshot(req2).await.unwrap();
        let pw1: String = parse_json(&body_string(res1).await);
        let pw2: String = parse_json(&body_string(res2).await);
        assert_ne!(pw1, pw2, "generated passwords should differ");
    });
}

#[test]
fn test_unknown_route_returns_404() {
    run(async {
        let req = Request::builder()
            .method("GET")
            .uri("/api/v1/get/doesnotexist")
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    });
}

#[test]
fn test_change_master_password_too_many_passwords() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        let req = Request::builder()
            .method("POST")
            .uri("/api/v2/user")
            .auth(user, pw)
            .body(Body::empty())
            .unwrap();
        app().oneshot(req).await.unwrap();

        let req = Request::builder()
            .method("POST")
            .uri("/api/v2/passwords/only")
            .auth(user, pw)
            .header("content-type", "application/json")
            .body(Body::from(r#"{"encrypted_password":"enc"}"#))
            .unwrap();
        app().oneshot(req).await.unwrap();

        // 2 re-encrypted passwords instead of 1
        let req = Request::builder()
            .method("PUT")
            .uri("/api/v2/user")
            .auth(user, pw)
            .header("content-type", "application/json")
            .body(Body::from(r#"{"new_password":"newpw","passwords":["a","b"]}"#))
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "too many passwords rejected");
    });
}

#[test]
fn test_change_master_no_stored_passwords() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        let req = Request::builder()
            .method("POST")
            .uri("/api/v2/user")
            .auth(user, pw)
            .body(Body::empty())
            .unwrap();
        app().oneshot(req).await.unwrap();

        // Change master when there are zero stored passwords — should succeed with empty array
        let new_pw = "brand_new_pw";
        let req = Request::builder()
            .method("PUT")
            .uri("/api/v2/user")
            .auth(user, pw)
            .header("content-type", "application/json")
            .body(Body::from(format!(
                r#"{{"new_password":"{new_pw}","passwords":[]}}"#
            )))
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK, "change master with no stored pws");

        // Verify new password works
        let req = Request::builder()
            .method("GET")
            .uri("/api/v2/user/verify")
            .auth(user, new_pw)
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK, "new pw works after master change");
    });
}
