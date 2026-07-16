# Buckets migration runbook (schema v1 → v2, API v2 → v3)

## What changes

- **DB schema v2**: each user's `stored_passwords: [{key, en_password}]` becomes
  `buckets: [{key, fields: [{label, en_value, sensitive}]}]`, plus
  `schema_version: 2` and `master_key.iterations` (self-describing hash).
  Ciphertexts are copied byte-for-byte — no re-encryption.
- **API v3** (`/api/v3/...`) exposes buckets/fields. **API v2 routes remain**
  as thin adapters over buckets, so old clients and the backcompat test suite
  keep working. Exception: `PUT /api/v2/user` (master-password change) is
  rejected once any bucket has a non-password field — an old client can't
  re-encrypt fields it doesn't know about.
- The new API **refuses documents that aren't at schema v2** (loud error
  instead of silently-empty vaults), so code and migration must deploy
  together per database.
- PBKDF2 target bumped 100k → 210k iterations; existing users are silently
  re-hashed on their next successful login.

## Migration tool

`passwords/api/src/bin/migrate_v2.rs`, using the same env vars as the API
(`MONGO_USER`, `MONGO_PW`, `MONGO_ENDPOINT`, `USERS_DB_NAME`).

| Mode | Command | Effect |
|---|---|---|
| Dry run | `cargo run --bin migrate_v2` | Report what would change; writes nothing |
| Apply | `cargo run --bin migrate_v2 -- --apply` | Reshape docs; **keeps** `stored_passwords` as a safety copy |
| Verify | `cargo run --bin migrate_v2 -- --verify` | Byte-compare every old entry against its bucket; non-zero exit on any problem |
| Cleanup | `cargo run --bin migrate_v2 -- --cleanup` | Drop `stored_passwords`, per-doc, only after that doc re-verifies |

Apply is idempotent (schema-v2 docs are skipped). Verify tolerates buckets
created after migration.

## Order of operations

1. **Rehearse** on a copy: `mongodump` prod → `mongorestore` to a scratch DB →
   run dry-run / apply / verify against it → boot the API against it and log in.
2. **Migrate the CI/test database first** (the one the GitHub Actions secrets
   point at, which holds the permanent backcompat user). Until this is done,
   the new code's CI runs will fail with "requires migration" errors.
3. Open the PR; CI (including the backcompat suite, which now doubles as
   migration verification) must pass.
4. **Prod**: `mongodump` backup → `--apply` → `--verify` → merge the PR
   (push to main auto-deploys the API to Fly.io after tests) → deploy the
   frontend → log in and sanity-check.
5. Days later, once confident: `--cleanup` on both databases.

## Rollback

Between apply and cleanup, every document still contains the untouched
`stored_passwords` array, and the mongodump exists. Rolling back = redeploy
the previous API/frontend (old code ignores the new fields) or, worst case,
`mongorestore` the dump. After cleanup, rollback requires the dump.
