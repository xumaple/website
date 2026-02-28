//! Integration tests for the MapoPass API.
//!
//! These tests exercise the Rocket HTTP routes end-to-end against a real
//! MongoDB instance (configured via `.env`). They use Rocket's in-process
//! `Client` so no actual TCP port is opened.
//!
//! ## Architecture
//!
//! - **Shared runtime**: A single `LazyLock<Runtime>` keeps the MongoDB
//!   connection pool alive across all tests. Each `#[test]` function calls
//!   `run()` which delegates to `RT.block_on()`.
//!
//! - **Shared client**: A single `LazyLock<Client>` (Rocket's untracked test
//!   client) is initialized once on the shared runtime.
//!
//! - **TestUser RAII**: Each test that needs a user creates a `TestUser` whose
//!   `Drop` impl deletes it from the database. A separate OS thread is used
//!   for the cleanup to avoid nesting `block_on` calls.
//!
//! ## Running
//!
//! ```sh
//! # From passwords/api/:
//! cargo test --test integration_tests
//! ```

use mongodb::bson::oid::ObjectId;
use passwords::build_rocket;
use passwords::db;
use rocket::http::{ContentType, Header, Status};
use rocket::local::asynchronous::Client;
use std::sync::LazyLock;

const TEST_PW: &str = "test_password_abc123";

// ---------------------------------------------------------------------------
// Single shared runtime – keeps the MongoDB connection pool alive across tests.
// Shared Rocket client + DB connection (initialized once on the shared runtime).
// ---------------------------------------------------------------------------

static RT: LazyLock<tokio::runtime::Runtime> = LazyLock::new(|| {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("Failed to create shared tokio runtime")
});

static TEST_CLIENT: LazyLock<Client> = LazyLock::new(|| {
    RT.block_on(async {
        dotenv::dotenv().ok();
        db::connect().await.expect("Failed to connect to test DB");
        Client::untracked(build_rocket())
            .await
            .expect("Failed to create Rocket test client")
    })
});

/// Returns the shared Rocket client, initializing DB + client on first call.
fn client() -> &'static Client {
    &TEST_CLIENT
}

// ---------------------------------------------------------------------------
// WithAuth: extension trait for attaching credentials to test requests.
// ---------------------------------------------------------------------------

trait WithAuth {
    fn auth(self, user: &str, pw: &str) -> Self;
}

impl<'c> WithAuth for rocket::local::asynchronous::LocalRequest<'c> {
    fn auth(self, user: &str, pw: &str) -> Self {
        self.header(Header::new("x-username", user.to_string()))
            .header(Header::new("x-password", pw.to_string()))
    }
}

// ---------------------------------------------------------------------------
// TestUser: RAII guard that generates a unique username and deletes it on drop.
// ---------------------------------------------------------------------------

struct TestUser {
    username: String,
    password: String,
}

impl TestUser {
    fn new() -> Self {
        Self {
            username: format!("__test_{}__", ObjectId::new().to_hex()),
            password: TEST_PW.to_string(),
        }
    }

    fn user(&self) -> &str {
        &self.username
    }

    fn pw(&self) -> &str {
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
                let _ = db::delete_user(&username).await;
            });
        })
        .join()
        .ok();
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn parse_json<T: serde::de::DeserializeOwned>(body: &str) -> T {
    serde_json::from_str(body).expect("Failed to parse JSON response")
}

/// Run an async test body on the shared runtime.
/// Ensures the client (and DB) is initialized before entering the runtime.
fn run<F: std::future::Future>(f: F) -> F::Output {
    // Trigger client initialization BEFORE entering block_on, to avoid nested
    // block_on calls (TEST_CLIENT's LazyLock uses RT.block_on internally).
    let _ = client();
    RT.block_on(f)
}

// ===========================================================================
// Tests
// ===========================================================================

// ── Smoke tests ────────────────────────────────────────────────────────────

#[test]
fn test_root() {
    run(async {
        let c = client();
        let res = c.get("/").dispatch().await;
        assert_eq!(res.status(), Status::Ok);
        assert_eq!(res.into_string().await.unwrap(), "Don't get hacked");
    });
}

#[test]
fn test_generate_password() {
    run(async {
        let c = client();
        let res = c.get("/api/v2/generate").dispatch().await;
        assert_eq!(res.status(), Status::Ok);
        let pw: String = parse_json(&res.into_string().await.unwrap());
        assert_eq!(pw.len(), 15); // PASSWORD_LEN
    });
}

// ── Happy-path lifecycle ───────────────────────────────────────────────────

#[test]
fn test_full_user_lifecycle() {
    run(async {
        let c = client();
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        // 1. Create user
        let res = c
            .post("/api/v2/user")
            .auth(user, pw)
            .dispatch()
            .await;
        assert_eq!(res.status(), Status::Ok, "create user");

        // 2. Verify user
        let res = c
            .get("/api/v2/user/verify")
            .auth(user, pw)
            .dispatch()
            .await;
        assert_eq!(res.status(), Status::Ok, "verify user");

        // 3. Wrong password → 404
        let res = c
            .get("/api/v2/user/verify")
            .auth(user, "wrong")
            .dispatch()
            .await;
        assert_eq!(res.status(), Status::NotFound, "wrong password");

        // 4. Keys should be empty
        let res = c
            .get("/api/v2/keys")
            .auth(user, pw)
            .dispatch()
            .await;
        assert_eq!(res.status(), Status::Ok);
        let keys: Vec<String> = parse_json(&res.into_string().await.unwrap());
        assert!(keys.is_empty(), "new user has no keys");

        // 5. Add passwords
        for (key, val) in [("gmail", "enc_gmail"), ("github", "enc_github")] {
            let res = c
                .post(format!("/api/v2/passwords/{key}"))
                .auth(user, pw)
                .header(ContentType::JSON)
                .body(format!(r#"{{"encrypted_password":"{val}"}}"#))
                .dispatch()
                .await;
            assert_eq!(res.status(), Status::Ok, "add {key}");
        }

        // 6. Keys should have 2
        let res = c
            .get("/api/v2/keys")
            .auth(user, pw)
            .dispatch()
            .await;
        let keys: Vec<String> = parse_json(&res.into_string().await.unwrap());
        assert_eq!(keys.len(), 2);
        assert!(keys.contains(&"gmail".into()));
        assert!(keys.contains(&"github".into()));

        // 7. Get individual password
        let res = c
            .get("/api/v2/passwords/gmail")
            .auth(user, pw)
            .dispatch()
            .await;
        assert_eq!(
            parse_json::<String>(&res.into_string().await.unwrap()),
            "enc_gmail"
        );

        // 8. Get all passwords
        let res = c
            .get("/api/v2/passwords")
            .auth(user, pw)
            .dispatch()
            .await;
        let all: Vec<String> = parse_json(&res.into_string().await.unwrap());
        assert_eq!(all.len(), 2);

        // 9. Change a stored password
        let res = c
            .put("/api/v2/passwords/gmail")
            .auth(user, pw)
            .header(ContentType::JSON)
            .body(r#"{"encrypted_password":"new_gmail"}"#)
            .dispatch()
            .await;
        assert_eq!(res.status(), Status::Ok, "change stored pw");

        let res = c
            .get("/api/v2/passwords/gmail")
            .auth(user, pw)
            .dispatch()
            .await;
        assert_eq!(
            parse_json::<String>(&res.into_string().await.unwrap()),
            "new_gmail"
        );

        // 10. Change master password
        let new_pw = "new_master_password_xyz";
        let res = c
            .put("/api/v2/user")
            .auth(user, pw)
            .header(ContentType::JSON)
            .body(format!(
                r#"{{"new_password":"{new_pw}","passwords":["reenc_gmail","reenc_github"]}}"#
            ))
            .dispatch()
            .await;
        assert_eq!(res.status(), Status::Ok, "change master");

        // 11. Old password fails
        let res = c
            .get("/api/v2/user/verify")
            .auth(user, pw)
            .dispatch()
            .await;
        assert_eq!(res.status(), Status::NotFound, "old pw rejected");

        // 12. New password works
        let res = c
            .get("/api/v2/user/verify")
            .auth(user, new_pw)
            .dispatch()
            .await;
        assert_eq!(res.status(), Status::Ok, "new pw accepted");

        // 13. Passwords re-encrypted
        let res = c
            .get("/api/v2/passwords/gmail")
            .auth(user, new_pw)
            .dispatch()
            .await;
        assert_eq!(
            parse_json::<String>(&res.into_string().await.unwrap()),
            "reenc_gmail"
        );
    });
}

// ── Error / edge-case tests ────────────────────────────────────────────────

#[test]
fn test_duplicate_user_rejected() {
    run(async {
        let c = client();
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        let res = c
            .post("/api/v2/user")
            .auth(user, pw)
            .dispatch()
            .await;
        assert_eq!(res.status(), Status::Ok);

        let res = c
            .post("/api/v2/user")
            .auth(user, pw)
            .dispatch()
            .await;
        assert_eq!(res.status(), Status::NotFound, "duplicate user rejected");
    });
}

#[test]
fn test_duplicate_key_rejected() {
    run(async {
        let c = client();
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        c.post("/api/v2/user")
            .auth(user, pw)
            .dispatch()
            .await;

        let res = c
            .post("/api/v2/passwords/mykey")
            .auth(user, pw)
            .header(ContentType::JSON)
            .body(r#"{"encrypted_password":"v1"}"#)
            .dispatch()
            .await;
        assert_eq!(res.status(), Status::Ok);

        let res = c
            .post("/api/v2/passwords/mykey")
            .auth(user, pw)
            .header(ContentType::JSON)
            .body(r#"{"encrypted_password":"v2"}"#)
            .dispatch()
            .await;
        assert_eq!(res.status(), Status::NotFound, "duplicate key rejected");
    });
}

#[test]
fn test_nonexistent_key_returns_error() {
    run(async {
        let c = client();
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        c.post("/api/v2/user")
            .auth(user, pw)
            .dispatch()
            .await;

        let res = c
            .get("/api/v2/passwords/bogus")
            .auth(user, pw)
            .dispatch()
            .await;
        assert_eq!(res.status(), Status::NotFound, "nonexistent key → 404");
    });
}

#[test]
fn test_change_master_password_mismatched_count() {
    run(async {
        let c = client();
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        c.post("/api/v2/user")
            .auth(user, pw)
            .dispatch()
            .await;

        c.post("/api/v2/passwords/site")
            .auth(user, pw)
            .header(ContentType::JSON)
            .body(r#"{"encrypted_password":"enc"}"#)
            .dispatch()
            .await;

        // 0 re-encrypted passwords instead of 1
        let res = c
            .put("/api/v2/user")
            .auth(user, pw)
            .header(ContentType::JSON)
            .body(r#"{"new_password":"newpw","passwords":[]}"#)
            .dispatch()
            .await;
        assert_eq!(
            res.status(),
            Status::NotFound,
            "mismatched count rejected"
        );
    });
}

#[test]
fn test_nonexistent_user_verify() {
    run(async {
        let c = client();
        let t = TestUser::new();
        // Never create the user — all ops should fail
        let (user, pw) = (t.user(), t.pw());

        let res = c
            .get("/api/v2/user/verify")
            .auth(user, pw)
            .dispatch()
            .await;
        assert_eq!(res.status(), Status::NotFound, "verify nonexistent user");
    });
}

#[test]
fn test_nonexistent_user_get_keys() {
    run(async {
        let c = client();
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        let res = c
            .get("/api/v2/keys")
            .auth(user, pw)
            .dispatch()
            .await;
        assert_eq!(res.status(), Status::NotFound, "getkeys nonexistent user");
    });
}

#[test]
fn test_wrong_password_on_add_stored_password() {
    run(async {
        let c = client();
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        c.post("/api/v2/user")
            .auth(user, pw)
            .dispatch()
            .await;

        let res = c
            .post("/api/v2/passwords/key1")
            .auth(user, "wrongpw")
            .header(ContentType::JSON)
            .body(r#"{"encrypted_password":"v1"}"#)
            .dispatch()
            .await;
        assert_eq!(res.status(), Status::NotFound, "wrong pw on add stored pw");
    });
}

#[test]
fn test_wrong_password_on_change_stored_password() {
    run(async {
        let c = client();
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        c.post("/api/v2/user")
            .auth(user, pw)
            .dispatch()
            .await;

        c.post("/api/v2/passwords/key1")
            .auth(user, pw)
            .header(ContentType::JSON)
            .body(r#"{"encrypted_password":"v1"}"#)
            .dispatch()
            .await;

        let res = c
            .put("/api/v2/passwords/key1")
            .auth(user, "wrongpw")
            .header(ContentType::JSON)
            .body(r#"{"encrypted_password":"v2"}"#)
            .dispatch()
            .await;
        assert_eq!(res.status(), Status::NotFound, "wrong pw on change stored pw");
    });
}

#[test]
fn test_wrong_password_on_change_master() {
    run(async {
        let c = client();
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        c.post("/api/v2/user")
            .auth(user, pw)
            .dispatch()
            .await;

        let res = c
            .put("/api/v2/user")
            .auth(user, "wrongpw")
            .header(ContentType::JSON)
            .body(r#"{"new_password":"newpw","passwords":[]}"#)
            .dispatch()
            .await;
        assert_eq!(res.status(), Status::NotFound, "wrong pw on change master");
    });
}

#[test]
fn test_change_nonexistent_stored_password_key() {
    run(async {
        let c = client();
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        c.post("/api/v2/user")
            .auth(user, pw)
            .dispatch()
            .await;

        let res = c
            .put("/api/v2/passwords/nokey")
            .auth(user, pw)
            .header(ContentType::JSON)
            .body(r#"{"encrypted_password":"v"}"#)
            .dispatch()
            .await;
        assert_eq!(res.status(), Status::NotFound, "change nonexistent key");
    });
}

#[test]
fn test_get_passwords_empty() {
    run(async {
        let c = client();
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        c.post("/api/v2/user")
            .auth(user, pw)
            .dispatch()
            .await;

        // getpws on user with no stored passwords
        let res = c
            .get("/api/v2/passwords")
            .auth(user, pw)
            .dispatch()
            .await;
        assert_eq!(res.status(), Status::Ok);
        let pws: Vec<String> = parse_json(&res.into_string().await.unwrap());
        assert!(pws.is_empty(), "new user has no passwords");
    });
}

#[test]
fn test_generated_passwords_are_unique() {
    run(async {
        let c = client();
        let res1 = c.get("/api/v2/generate").dispatch().await;
        let res2 = c.get("/api/v2/generate").dispatch().await;
        let pw1: String = parse_json(&res1.into_string().await.unwrap());
        let pw2: String = parse_json(&res2.into_string().await.unwrap());
        assert_ne!(pw1, pw2, "generated passwords should differ");
    });
}

#[test]
fn test_unknown_route_returns_404() {
    run(async {
        let c = client();
        let res = c.get("/api/v1/get/doesnotexist").dispatch().await;
        assert_eq!(res.status(), Status::NotFound);
    });
}

#[test]
fn test_change_master_password_too_many_passwords() {
    run(async {
        let c = client();
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        c.post("/api/v2/user")
            .auth(user, pw)
            .dispatch()
            .await;

        c.post("/api/v2/passwords/only")
            .auth(user, pw)
            .header(ContentType::JSON)
            .body(r#"{"encrypted_password":"enc"}"#)
            .dispatch()
            .await;

        // 2 re-encrypted passwords instead of 1
        let res = c
            .put("/api/v2/user")
            .auth(user, pw)
            .header(ContentType::JSON)
            .body(r#"{"new_password":"newpw","passwords":["a","b"]}"#)
            .dispatch()
            .await;
        assert_eq!(res.status(), Status::NotFound, "too many passwords rejected");
    });
}

#[test]
fn test_change_master_no_stored_passwords() {
    run(async {
        let c = client();
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        c.post("/api/v2/user")
            .auth(user, pw)
            .dispatch()
            .await;

        // Change master when there are zero stored passwords — should succeed with empty array
        let new_pw = "brand_new_pw";
        let res = c
            .put("/api/v2/user")
            .auth(user, pw)
            .header(ContentType::JSON)
            .body(format!(
                r#"{{"new_password":"{new_pw}","passwords":[]}}"#
            ))
            .dispatch()
            .await;
        assert_eq!(res.status(), Status::Ok, "change master with no stored pws");

        // Verify new password works
        let res = c
            .get("/api/v2/user/verify")
            .auth(user, new_pw)
            .dispatch()
            .await;
        assert_eq!(res.status(), Status::Ok, "new pw works after master change");
    });
}