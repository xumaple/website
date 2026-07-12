//! One-shot v1 -> v2 schema migration for the users collection.
//!
//! v1: { _id, master_key: { master_pw, salt }, stored_passwords: [{ key, en_password }] }
//! v2: { _id, master_key: { master_pw, salt, iterations }, schema_version: 2,
//!       buckets: [{ key, fields: [{ label, en_value, sensitive }] }] }
//!
//! Ciphertexts are copied verbatim — each stored password becomes a bucket
//! with a single sensitive "password" field. No re-encryption happens.
//!
//! Runs against the same .env (MONGO_USER / MONGO_PW / MONGO_ENDPOINT /
//! USERS_DB_NAME) as the API. Take a mongodump backup before --apply.
//!
//! Usage:
//!   cargo run --bin migrate_v2              # dry run: report what would change
//!   cargo run --bin migrate_v2 -- --apply   # reshape docs; keeps stored_passwords
//!   cargo run --bin migrate_v2 -- --verify  # check every old entry survived intact
//!   cargo run --bin migrate_v2 -- --cleanup # drop stored_passwords from verified docs
//!
//! Deliberately operates on raw BSON documents rather than the API's `User`
//! type: deserializing a v1 doc through the v2 type would silently drop
//! `stored_passwords`, which is exactly the data being migrated.

use futures::stream::TryStreamExt;
use mongodb::{
    bson::{bson, doc, Bson, Document},
    options::ClientOptions,
    Client, Collection,
};
use passwords::env::EnvVars;

const SCHEMA_VERSION: i32 = passwords::db::SCHEMA_VERSION as i32;
const LEGACY_N_ITER: i32 = passwords::encrypt::LEGACY_N_ITER as i32;

#[derive(PartialEq, Clone, Copy)]
enum Mode {
    DryRun,
    Apply,
    Verify,
    Cleanup,
}

async fn connect() -> Result<Collection<Document>, Box<dyn std::error::Error>> {
    let env = EnvVars::get();
    let client = Client::with_options(
        ClientOptions::parse(
            format!(
                "mongodb+srv://{}:{}@{}?retryWrites=true&w=majority",
                env.mongo_user, env.mongo_pw, env.mongo_endpoint,
            )
            .as_str(),
        )
        .await?,
    )?;
    Ok(client
        .database(&env.users_db_name)
        .collection::<Document>("users"))
}

fn stored_to_buckets(stored: &[Bson], id: &str) -> Result<Vec<Bson>, String> {
    stored
        .iter()
        .map(|entry| {
            let entry = entry
                .as_document()
                .ok_or(format!("user {id}: non-document stored_passwords entry"))?;
            let key = entry
                .get_str("key")
                .map_err(|_| format!("user {id}: stored_passwords entry missing key"))?;
            let en_password = entry
                .get_str("en_password")
                .map_err(|_| format!("user {id}: entry {key} missing en_password"))?;
            Ok(bson!({
                "key": key,
                "fields": [{ "label": "password", "en_value": en_password, "sensitive": true }],
            }))
        })
        .collect()
}

/// Every v1 entry must survive as an identical ciphertext in its bucket's
/// "password" field. Extra buckets are fine (created post-migration via the
/// new API); missing or altered ones are not.
fn verify_doc(user: &Document, id: &str) -> Vec<String> {
    let mut problems = vec![];

    if user.get_i32("schema_version").unwrap_or(0) != SCHEMA_VERSION {
        problems.push(format!("user {id}: schema_version is not {SCHEMA_VERSION}"));
    }
    let iterations_present = user
        .get_document("master_key")
        .map(|mk| mk.get("iterations").is_some())
        .unwrap_or(false);
    if !iterations_present {
        problems.push(format!("user {id}: master_key.iterations missing"));
    }

    let empty = vec![];
    let stored = user.get_array("stored_passwords").unwrap_or(&empty);
    let buckets = user.get_array("buckets").unwrap_or(&empty);

    for entry in stored {
        let (Some(key), Some(en_password)) = (
            entry.as_document().and_then(|e| e.get_str("key").ok()),
            entry
                .as_document()
                .and_then(|e| e.get_str("en_password").ok()),
        ) else {
            problems.push(format!("user {id}: malformed stored_passwords entry"));
            continue;
        };

        let matched = buckets.iter().any(|b| {
            let Some(b) = b.as_document() else {
                return false;
            };
            b.get_str("key") == Ok(key)
                && b.get_array("fields").is_ok_and(|fields| {
                    fields.iter().any(|f| {
                        let Some(f) = f.as_document() else {
                            return false;
                        };
                        f.get_str("label") == Ok("password")
                            && f.get_str("en_value") == Ok(en_password)
                            && f.get_bool("sensitive") == Ok(true)
                    })
                })
        });
        if !matched {
            problems.push(format!(
                "user {id}: key {key} has no bucket with an identical password ciphertext"
            ));
        }
    }

    problems
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv::dotenv().ok();

    let mode = match std::env::args().nth(1).as_deref() {
        None => Mode::DryRun,
        Some("--apply") => Mode::Apply,
        Some("--verify") => Mode::Verify,
        Some("--cleanup") => Mode::Cleanup,
        Some(other) => {
            eprintln!("Unknown argument {other}. Usage: migrate_v2 [--apply|--verify|--cleanup]");
            std::process::exit(2);
        }
    };

    let coll = connect().await?;
    let mut cursor = coll.find(doc! {}).await?;

    let (mut seen, mut acted, mut skipped) = (0u32, 0u32, 0u32);
    let mut problems: Vec<String> = vec![];

    while let Some(user) = cursor.try_next().await? {
        seen += 1;
        let id = user.get_object_id("_id")?.to_hex();

        match mode {
            Mode::DryRun | Mode::Apply => {
                if user.get_i32("schema_version").unwrap_or(0) >= SCHEMA_VERSION {
                    skipped += 1;
                    continue;
                }
                let empty = vec![];
                let stored = user.get_array("stored_passwords").unwrap_or(&empty);
                let buckets = match stored_to_buckets(stored, &id) {
                    Ok(b) => b,
                    Err(e) => {
                        problems.push(e);
                        continue;
                    }
                };
                let iterations = user
                    .get_document("master_key")
                    .ok()
                    .and_then(|mk| mk.get_i32("iterations").ok())
                    .unwrap_or(LEGACY_N_ITER);
                println!(
                    "user {id}: {} stored passwords -> {} buckets (iterations: {iterations})",
                    stored.len(),
                    buckets.len(),
                );
                if mode == Mode::Apply {
                    coll.update_one(
                        doc! { "_id": user.get_object_id("_id")? },
                        doc! { "$set": {
                            "buckets": buckets,
                            "schema_version": SCHEMA_VERSION,
                            "master_key.iterations": iterations,
                        } },
                    )
                    .await?;
                }
                acted += 1;
            }
            Mode::Verify => {
                let doc_problems = verify_doc(&user, &id);
                if doc_problems.is_empty() {
                    acted += 1;
                } else {
                    problems.extend(doc_problems);
                }
            }
            Mode::Cleanup => {
                if user.get("stored_passwords").is_none() {
                    skipped += 1;
                    continue;
                }
                let doc_problems = verify_doc(&user, &id);
                if doc_problems.is_empty() {
                    coll.update_one(
                        doc! { "_id": user.get_object_id("_id")? },
                        doc! { "$unset": { "stored_passwords": "" } },
                    )
                    .await?;
                    println!("user {id}: dropped stored_passwords");
                    acted += 1;
                } else {
                    problems.extend(doc_problems);
                }
            }
        }
    }

    let verb = match mode {
        Mode::DryRun => "would migrate",
        Mode::Apply => "migrated",
        Mode::Verify => "verified",
        Mode::Cleanup => "cleaned up",
    };
    println!(
        "{seen} users seen: {verb} {acted}, skipped {skipped}, {} problems",
        problems.len()
    );
    for p in &problems {
        eprintln!("PROBLEM: {p}");
    }
    if !problems.is_empty() {
        std::process::exit(1);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v1_doc() -> Document {
        doc! {
            "_id": mongodb::bson::oid::ObjectId::new(),
            "master_key": { "master_pw": "AB", "salt": "CD" },
            "stored_passwords": [
                { "key": "github", "en_password": "cipher1" },
                { "key": "bank", "en_password": "cipher2" },
            ],
        }
    }

    fn migrated(mut user: Document) -> Document {
        let stored = user.get_array("stored_passwords").unwrap();
        let buckets = stored_to_buckets(stored, "test").unwrap();
        user.insert("buckets", buckets);
        user.insert("schema_version", SCHEMA_VERSION);
        user.get_document_mut("master_key")
            .unwrap()
            .insert("iterations", LEGACY_N_ITER);
        user
    }

    #[test]
    fn reshape_makes_one_sensitive_password_field_per_key() {
        let user = v1_doc();
        let buckets = stored_to_buckets(user.get_array("stored_passwords").unwrap(), "t").unwrap();
        assert_eq!(buckets.len(), 2);
        let b = buckets[0].as_document().unwrap();
        assert_eq!(b.get_str("key").unwrap(), "github");
        let fields = b.get_array("fields").unwrap();
        assert_eq!(fields.len(), 1);
        let f = fields[0].as_document().unwrap();
        assert_eq!(f.get_str("label").unwrap(), "password");
        assert_eq!(f.get_str("en_value").unwrap(), "cipher1");
        assert!(f.get_bool("sensitive").unwrap());
    }

    #[test]
    fn verify_passes_on_faithful_migration() {
        assert!(verify_doc(&migrated(v1_doc()), "t").is_empty());
    }

    #[test]
    fn verify_flags_unmigrated_missing_and_tampered_docs() {
        assert!(!verify_doc(&v1_doc(), "t").is_empty());

        let mut missing = migrated(v1_doc());
        missing.get_array_mut("buckets").unwrap().pop();
        assert!(!verify_doc(&missing, "t").is_empty());

        let mut tampered = migrated(v1_doc());
        *tampered.get_array_mut("buckets").unwrap().get_mut(0).unwrap() = bson!({
            "key": "github",
            "fields": [{ "label": "password", "en_value": "DIFFERENT", "sensitive": true }],
        });
        assert!(!verify_doc(&tampered, "t").is_empty());

        let mut no_iter = migrated(v1_doc());
        no_iter
            .get_document_mut("master_key")
            .unwrap()
            .remove("iterations");
        assert!(!verify_doc(&no_iter, "t").is_empty());
    }

    #[test]
    fn verify_allows_extra_buckets_added_after_migration() {
        let mut user = migrated(v1_doc());
        user.get_array_mut("buckets").unwrap().push(bson!({
            "key": "new-service",
            "fields": [{ "label": "email", "en_value": "cipher3", "sensitive": false }],
        }));
        assert!(verify_doc(&user, "t").is_empty());
    }
}
