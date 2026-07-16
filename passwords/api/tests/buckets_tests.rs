//! Integration tests for the v3 bucket-native API and its v2 adapter interop.
//!
//! These tests exercise the Axum HTTP routes end-to-end against a real
//! MongoDB instance (configured via `.env`). They use Axum's in-process
//! `Router` with `tower::ServiceExt::oneshot` so no actual TCP port is opened.
//!
//! ## Running
//!
//! ```sh
//! # From passwords/api/:
//! cargo test --test buckets_tests --features test-helpers
//! ```

mod common;

use axum::body::Body;
use common::{app, body_string, parse_json, run, TestUser, WithAuth};
use http::{Request, StatusCode};
use passwords::db::{Bucket, Field};
use serde_json::json;
use tower::ServiceExt;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Send a request with auth headers and an optional JSON body.
async fn send(
    method: &str,
    uri: &str,
    user: &str,
    pw: &str,
    body: Option<serde_json::Value>,
) -> axum::response::Response {
    let builder = Request::builder().method(method).uri(uri).auth(user, pw);
    let req = match body {
        Some(v) => builder
            .header("content-type", "application/json")
            .body(Body::from(v.to_string()))
            .unwrap(),
        None => builder.body(Body::empty()).unwrap(),
    };
    app().oneshot(req).await.unwrap()
}

/// Create a user via the v3 API, asserting success.
async fn create_v3_user(user: &str, pw: &str) {
    let res = send("POST", "/api/v3/user", user, pw, None).await;
    assert_eq!(res.status(), StatusCode::OK, "create v3 user");
}

/// Create a bucket via the v3 API, asserting success.
async fn create_v3_bucket(user: &str, pw: &str, key: &str, fields: serde_json::Value) {
    let res = send(
        "POST",
        &format!("/api/v3/bucket/{key}"),
        user,
        pw,
        Some(fields),
    )
    .await;
    assert_eq!(res.status(), StatusCode::OK, "create bucket {key}");
}

fn field_json(label: &str, en_value: &str, sensitive: bool) -> serde_json::Value {
    json!({ "label": label, "en_value": en_value, "sensitive": sensitive })
}

// ---------------------------------------------------------------------------
// User lifecycle
// ---------------------------------------------------------------------------

#[test]
fn test_v3_create_user_and_verify() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());

        create_v3_user(user, pw).await;

        let res = send("GET", "/api/v3/user/verify", user, pw, None).await;
        assert_eq!(res.status(), StatusCode::OK, "verify user");

        let res = send("GET", "/api/v3/user/verify", user, "wrong", None).await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "wrong password");
    });
}

// ---------------------------------------------------------------------------
// Bucket CRUD
// ---------------------------------------------------------------------------

#[test]
fn test_v3_bucket_create_and_read() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());
        create_v3_user(user, pw).await;

        // New user has no buckets
        let res = send("GET", "/api/v3/buckets", user, pw, None).await;
        assert_eq!(res.status(), StatusCode::OK);
        let keys: Vec<String> = parse_json(&body_string(res).await);
        assert!(keys.is_empty(), "new user has no buckets");

        // Create a bucket with multiple fields
        create_v3_bucket(
            user,
            pw,
            "github",
            json!([
                field_json("password", "enc_pw", true),
                field_json("email", "enc_email", false),
                field_json("2fa-backup", "enc_2fa", true),
            ]),
        )
        .await;

        // Keys
        let res = send("GET", "/api/v3/buckets", user, pw, None).await;
        let keys: Vec<String> = parse_json(&body_string(res).await);
        assert_eq!(keys, vec!["github"]);

        // Get single bucket
        let res = send("GET", "/api/v3/bucket/github", user, pw, None).await;
        assert_eq!(res.status(), StatusCode::OK);
        let bucket: Bucket = parse_json(&body_string(res).await);
        assert_eq!(bucket.key, "github");
        assert_eq!(bucket.fields.len(), 3);
        assert_eq!(bucket.fields[0].label, "password");
        assert_eq!(bucket.fields[0].en_value, "enc_pw");
        assert!(bucket.fields[0].sensitive);
        assert_eq!(bucket.fields[1].label, "email");
        assert!(!bucket.fields[1].sensitive);

        // buckets/all
        create_v3_bucket(user, pw, "empty", json!([])).await;
        let res = send("GET", "/api/v3/buckets/all", user, pw, None).await;
        assert_eq!(res.status(), StatusCode::OK);
        let all: Vec<Bucket> = parse_json(&body_string(res).await);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].key, "github");
        assert_eq!(all[0].fields.len(), 3);
        assert_eq!(all[1].key, "empty");
        assert!(all[1].fields.is_empty());

        // Nonexistent bucket 404s
        let res = send("GET", "/api/v3/bucket/bogus", user, pw, None).await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "nonexistent bucket");

        // Duplicate bucket key rejected
        let res = send("POST", "/api/v3/bucket/github", user, pw, Some(json!([]))).await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "duplicate bucket key");
    });
}

#[test]
fn test_v3_upsert_adds_new_field() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());
        create_v3_user(user, pw).await;
        create_v3_bucket(user, pw, "site", json!([field_json("password", "enc1", true)])).await;

        let res = send(
            "PUT",
            "/api/v3/bucket/site/field/username",
            user,
            pw,
            Some(json!({ "en_value": "enc_username", "sensitive": false })),
        )
        .await;
        assert_eq!(res.status(), StatusCode::OK, "upsert new field");

        let res = send("GET", "/api/v3/bucket/site", user, pw, None).await;
        let bucket: Bucket = parse_json(&body_string(res).await);
        assert_eq!(bucket.fields.len(), 2);
        let f: &Field = bucket
            .fields
            .iter()
            .find(|f| f.label == "username")
            .expect("username field added");
        assert_eq!(f.en_value, "enc_username");
        assert!(!f.sensitive);
    });
}

#[test]
fn test_v3_upsert_edits_existing_field_in_place() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());
        create_v3_user(user, pw).await;
        create_v3_bucket(
            user,
            pw,
            "site",
            json!([
                field_json("password", "enc_old", true),
                field_json("email", "enc_email", false),
            ]),
        )
        .await;

        let res = send(
            "PUT",
            "/api/v3/bucket/site/field/password",
            user,
            pw,
            Some(json!({ "en_value": "enc_new", "sensitive": false })),
        )
        .await;
        assert_eq!(res.status(), StatusCode::OK, "upsert existing field");

        let res = send("GET", "/api/v3/bucket/site", user, pw, None).await;
        let bucket: Bucket = parse_json(&body_string(res).await);
        // Edited in place: no new field, same order, updated value + sensitivity.
        assert_eq!(bucket.fields.len(), 2);
        assert_eq!(bucket.fields[0].label, "password");
        assert_eq!(bucket.fields[0].en_value, "enc_new");
        assert!(!bucket.fields[0].sensitive);
        assert_eq!(bucket.fields[1].label, "email");
        assert_eq!(bucket.fields[1].en_value, "enc_email");
    });
}

#[test]
fn test_v3_upsert_field_on_missing_bucket_404s() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());
        create_v3_user(user, pw).await;

        let res = send(
            "PUT",
            "/api/v3/bucket/nope/field/password",
            user,
            pw,
            Some(json!({ "en_value": "enc", "sensitive": true })),
        )
        .await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "missing bucket");
    });
}

#[test]
fn test_v3_delete_field() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());
        create_v3_user(user, pw).await;
        create_v3_bucket(
            user,
            pw,
            "site",
            json!([
                field_json("password", "enc_pw", true),
                field_json("note", "enc_note", false),
            ]),
        )
        .await;

        let res = send("DELETE", "/api/v3/bucket/site/field/note", user, pw, None).await;
        assert_eq!(res.status(), StatusCode::OK, "delete field");

        let res = send("GET", "/api/v3/bucket/site", user, pw, None).await;
        let bucket: Bucket = parse_json(&body_string(res).await);
        assert_eq!(bucket.fields.len(), 1);
        assert_eq!(bucket.fields[0].label, "password");

        // Deleting a missing field 404s
        let res = send("DELETE", "/api/v3/bucket/site/field/note", user, pw, None).await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "missing field");

        // Deleting from a missing bucket 404s
        let res = send("DELETE", "/api/v3/bucket/bogus/field/note", user, pw, None).await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "missing bucket");
    });
}

#[test]
fn test_v3_rename_bucket() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());
        create_v3_user(user, pw).await;
        create_v3_bucket(user, pw, "oldname", json!([field_json("password", "enc", true)])).await;
        create_v3_bucket(user, pw, "taken", json!([])).await;

        // Rename to an existing key rejected
        let res = send(
            "POST",
            "/api/v3/bucket/oldname/rename",
            user,
            pw,
            Some(json!({ "new_key": "taken" })),
        )
        .await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "rename to existing key");

        // Rename a missing bucket rejected
        let res = send(
            "POST",
            "/api/v3/bucket/bogus/rename",
            user,
            pw,
            Some(json!({ "new_key": "whatever" })),
        )
        .await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "rename missing bucket");

        // Successful rename
        let res = send(
            "POST",
            "/api/v3/bucket/oldname/rename",
            user,
            pw,
            Some(json!({ "new_key": "newname" })),
        )
        .await;
        assert_eq!(res.status(), StatusCode::OK, "rename bucket");

        // Old key 404s
        let res = send("GET", "/api/v3/bucket/oldname", user, pw, None).await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "old key gone");

        // New key works with fields intact
        let res = send("GET", "/api/v3/bucket/newname", user, pw, None).await;
        assert_eq!(res.status(), StatusCode::OK, "new key readable");
        let bucket: Bucket = parse_json(&body_string(res).await);
        assert_eq!(bucket.key, "newname");
        assert_eq!(bucket.fields.len(), 1);
        assert_eq!(bucket.fields[0].en_value, "enc");
    });
}

#[test]
fn test_v3_delete_bucket() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());
        create_v3_user(user, pw).await;
        create_v3_bucket(user, pw, "doomed", json!([field_json("password", "enc", true)])).await;
        create_v3_bucket(user, pw, "keeper", json!([])).await;

        let res = send("DELETE", "/api/v3/bucket/doomed", user, pw, None).await;
        assert_eq!(res.status(), StatusCode::OK, "delete bucket");

        let res = send("GET", "/api/v3/bucket/doomed", user, pw, None).await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "deleted bucket gone");

        let res = send("GET", "/api/v3/buckets", user, pw, None).await;
        let keys: Vec<String> = parse_json(&body_string(res).await);
        assert_eq!(keys, vec!["keeper"]);

        // Deleting again 404s
        let res = send("DELETE", "/api/v3/bucket/doomed", user, pw, None).await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "double delete");
    });
}

// ---------------------------------------------------------------------------
// v3 master password change
// ---------------------------------------------------------------------------

#[test]
fn test_v3_change_master_password_with_multi_field_buckets() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());
        let new_pw = "new_master_password_v3";
        create_v3_user(user, pw).await;
        create_v3_bucket(
            user,
            pw,
            "github",
            json!([
                field_json("password", "old_pw", true),
                field_json("email", "old_email", false),
            ]),
        )
        .await;
        create_v3_bucket(user, pw, "bank", json!([field_json("password", "old_bank", true)]))
            .await;

        // Structurally matching re-encryption succeeds
        let res = send(
            "PUT",
            "/api/v3/user",
            user,
            pw,
            Some(json!({
                "new_password": new_pw,
                "buckets": [
                    { "key": "github", "fields": [
                        field_json("password", "new_pw_cipher", true),
                        field_json("email", "new_email_cipher", false),
                    ]},
                    { "key": "bank", "fields": [field_json("password", "new_bank", true)] },
                ],
            })),
        )
        .await;
        assert_eq!(res.status(), StatusCode::OK, "v3 master change");

        // Old creds rejected
        let res = send("GET", "/api/v3/user/verify", user, pw, None).await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "old pw rejected");

        // New creds work and values were replaced
        let res = send("GET", "/api/v3/bucket/github", user, new_pw, None).await;
        assert_eq!(res.status(), StatusCode::OK, "new pw accepted");
        let bucket: Bucket = parse_json(&body_string(res).await);
        assert_eq!(bucket.fields[0].en_value, "new_pw_cipher");
        assert_eq!(bucket.fields[1].en_value, "new_email_cipher");
    });
}

#[test]
fn test_v3_change_master_password_structural_mismatch_rejected() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());
        create_v3_user(user, pw).await;
        create_v3_bucket(
            user,
            pw,
            "github",
            json!([
                field_json("password", "old_pw", true),
                field_json("email", "old_email", false),
            ]),
        )
        .await;

        // Missing the "email" field — structurally mismatched
        let res = send(
            "PUT",
            "/api/v3/user",
            user,
            pw,
            Some(json!({
                "new_password": "should_not_apply",
                "buckets": [
                    { "key": "github", "fields": [field_json("password", "new_pw", true)] },
                ],
            })),
        )
        .await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "structural mismatch");

        // Original password still works
        let res = send("GET", "/api/v3/user/verify", user, pw, None).await;
        assert_eq!(res.status(), StatusCode::OK, "old pw still valid");
    });
}

// ---------------------------------------------------------------------------
// v2 adapter interop
// ---------------------------------------------------------------------------

#[test]
fn test_v2_created_password_visible_via_v3_and_v2() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());
        create_v3_user(user, pw).await;

        // Create via the v2 adapter
        let res = send(
            "POST",
            "/api/v2/passwords/gmail",
            user,
            pw,
            Some(json!({ "encrypted_password": "enc_gmail" })),
        )
        .await;
        assert_eq!(res.status(), StatusCode::OK, "v2 add password");

        // Readable as a v3 bucket: one sensitive "password" field
        let res = send("GET", "/api/v3/bucket/gmail", user, pw, None).await;
        assert_eq!(res.status(), StatusCode::OK, "v3 read of v2 bucket");
        let bucket: Bucket = parse_json(&body_string(res).await);
        assert_eq!(bucket.key, "gmail");
        assert_eq!(bucket.fields.len(), 1);
        assert_eq!(bucket.fields[0].label, "password");
        assert_eq!(bucket.fields[0].en_value, "enc_gmail");
        assert!(bucket.fields[0].sensitive);

        // And its password field is retrievable via the v2 adapter
        let res = send("GET", "/api/v2/passwords/gmail", user, pw, None).await;
        assert_eq!(res.status(), StatusCode::OK, "v2 read");
        assert_eq!(parse_json::<String>(&body_string(res).await), "enc_gmail");
    });
}

#[test]
fn test_v2_master_change_password_only_vault_ok_multi_field_rejected() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());
        let new_pw = "second_master_pw";
        create_v3_user(user, pw).await;

        // Password-only vault: v2 master change succeeds
        let res = send(
            "POST",
            "/api/v2/passwords/gmail",
            user,
            pw,
            Some(json!({ "encrypted_password": "enc1" })),
        )
        .await;
        assert_eq!(res.status(), StatusCode::OK, "v2 add");

        let res = send(
            "PUT",
            "/api/v2/user",
            user,
            pw,
            Some(json!({ "new_password": new_pw, "passwords": ["reenc1"] })),
        )
        .await;
        assert_eq!(res.status(), StatusCode::OK, "v2 master change on password-only vault");

        let res = send("GET", "/api/v2/passwords/gmail", user, new_pw, None).await;
        assert_eq!(parse_json::<String>(&body_string(res).await), "reenc1");

        // Add an extra (non-password) field via v3 — now the vault is no
        // longer password-only, so a v2 master change must be refused.
        let res = send(
            "PUT",
            "/api/v3/bucket/gmail/field/email",
            user,
            new_pw,
            Some(json!({ "en_value": "enc_email", "sensitive": false })),
        )
        .await;
        assert_eq!(res.status(), StatusCode::OK, "v3 add extra field");

        let res = send(
            "PUT",
            "/api/v2/user",
            user,
            new_pw,
            Some(json!({ "new_password": "third_pw", "passwords": ["reenc2"] })),
        )
        .await;
        assert_eq!(
            res.status(),
            StatusCode::NOT_FOUND,
            "v2 master change refused once a bucket has extra fields"
        );

        // Password unchanged
        let res = send("GET", "/api/v2/user/verify", user, new_pw, None).await;
        assert_eq!(res.status(), StatusCode::OK, "pw unchanged after refusal");
    });
}

// ---------------------------------------------------------------------------
// Key/label length validation
// ---------------------------------------------------------------------------

#[test]
fn test_v3_key_and_label_length_limits() {
    run(async {
        let t = TestUser::new();
        let (user, pw) = (t.user(), t.pw());
        create_v3_user(user, pw).await;
        create_v3_bucket(user, pw, "site", json!([field_json("password", "enc", true)])).await;

        let long = "a".repeat(129);

        // Over-long bucket key on create
        let res = send("POST", &format!("/api/v3/bucket/{long}"), user, pw, Some(json!([]))).await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "long key on create");

        // Over-long bucket key on get
        let res = send("GET", &format!("/api/v3/bucket/{long}"), user, pw, None).await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "long key on get");

        // Over-long new_key on rename
        let res = send(
            "POST",
            "/api/v3/bucket/site/rename",
            user,
            pw,
            Some(json!({ "new_key": long })),
        )
        .await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "long new_key on rename");

        // Over-long field label inside the create-bucket body (bypasses the
        // path extractors — must be caught by the handler's body validation)
        let res = send(
            "POST",
            "/api/v3/bucket/othersite",
            user,
            pw,
            Some(json!([field_json(&long, "enc", true)])),
        )
        .await;
        assert_eq!(
            res.status(),
            StatusCode::NOT_FOUND,
            "long label in create body"
        );
        let res = send("GET", "/api/v3/bucket/othersite", user, pw, None).await;
        assert_eq!(
            res.status(),
            StatusCode::NOT_FOUND,
            "bucket not created when a body label is too long"
        );

        // Over-long field label on upsert
        let res = send(
            "PUT",
            &format!("/api/v3/bucket/site/field/{long}"),
            user,
            pw,
            Some(json!({ "en_value": "enc", "sensitive": true })),
        )
        .await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "long label on upsert");

        // Over-long field label on delete
        let res = send(
            "DELETE",
            &format!("/api/v3/bucket/site/field/{long}"),
            user,
            pw,
            None,
        )
        .await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "long label on delete");

        // Bucket untouched by the rejected requests
        let res = send("GET", "/api/v3/bucket/site", user, pw, None).await;
        assert_eq!(res.status(), StatusCode::OK);
        let bucket: Bucket = parse_json(&body_string(res).await);
        assert_eq!(bucket.key, "site");
        assert_eq!(bucket.fields.len(), 1);
    });
}
