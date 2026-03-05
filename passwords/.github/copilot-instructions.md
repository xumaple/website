# MapoPass — Copilot Instructions

## Project Overview

MapoPass is a password manager with a **Rust/Rocket API** backend and a
**React (CRA) + Electron** frontend. Passwords are encrypted client-side
before being sent to the server; the server never sees plaintext passwords.

The git root is one level up (`website/`), and this project lives under
`passwords/`. There is a sibling `blog/` directory in the same repo.
The repository is hosted on **GitHub** at `xumaple/website`.

## Architecture

### API (`api/`)

- **Framework**: Rocket 0.5 (async)
- **Database**: MongoDB Atlas (via the `mongodb` crate)
- **Crypto**: `ring` (PBKDF2-HMAC-SHA512 for master key hashing, 100 000 iterations),
  `data-encoding` (hex encoding). Password generation via the `passwords` crate
  (renamed import `passwords_gen`).
- **Auth model**: Credentials (`x-username`, `x-password`) are sent as HTTP
  headers and extracted via a Rocket `FromRequest` guard on `Credentials`.
  Username is hashed to a MongoDB ObjectId; master password is verified with
  PBKDF2.
- **Key types**: `UnencryptedMasterKey` → `MasterKey` type-state pattern
  enforces that a plaintext password must be hashed before storage or
  verification.
- **Library crate**: `lib.rs` exposes `build_rocket()` and public modules
  `db` and `encrypt`. `main.rs` is a thin launcher.
- **Test-only routes**: `DELETE /api/v2/user` is gated behind
  `#[cfg(any(test, debug_assertions, feature = "test-helpers"))]`.
- **Env vars**: `MONGO_USER`, `MONGO_PW`, `MONGO_ENDPOINT` (loaded from
  `api/.env` locally, or from GitHub secrets in CI).
- **Cargo feature**: `test-helpers` — enables the delete-user route for
  integration tests in release-like builds.

### Frontend (`app/`)

- **Framework**: React 18 (Create React App), Material UI 5
- **Crypto (client-side)**: `crypto-js` — SHA-3 truncated to 16 chars for
  master key encoding (`encryptMaster`), SHA-256 as AES key derivation
  (`shaHash`), AES encrypt/decrypt for stored passwords.
- **Password flow**:
  1. `encryptMaster(plaintext)` → 16-char hash sent as `x-password` header.
  2. Server generates random passwords via `GET /api/v2/generate`.
  3. Client encrypts passwords with `encryptPw(plaintext, pw)` before
     `POST /api/v2/passwords/<key>`.
  4. Client fetches encrypted password, decrypts locally with `decryptPw`.
- **Electron**: Optional desktop wrapper (`public/electron.js`).

### API Routes (all under `/api/v2`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/generate` | No | Generate random password |
| POST | `/user` | Header | Create user |
| GET | `/user/verify` | Header | Verify credentials |
| PUT | `/user` | Header | Change master password (re-encrypts all passwords) |
| GET | `/keys` | Header | List stored password keys |
| GET | `/passwords/<key>` | Header | Get single encrypted password |
| GET | `/passwords` | Header | Get all encrypted passwords |
| POST | `/passwords/<key>` | Header | Add encrypted password |
| PUT | `/passwords/<key>` | Header | Update encrypted password |
| DELETE | `/user` | Header | Delete user (debug/test only) |

## Test Suites

### Rust Unit Tests

```sh
cd api && cargo test --lib
```

Covers `encrypt.rs` (PBKDF2, key derivation, MasterKey type-state, password
generation) and `db.rs` (OID generation, serialization, error handling).

### JavaScript Unit Tests

```sh
cd app && npm run test:unit
```

Covers `encrypt.js`: hashing, AES encrypt/decrypt, master-password change
logic, key-mismatch regression test.

### Rust Integration Tests

```sh
cd api && cargo test --test integration_tests --features test-helpers
```

Located in `api/tests/integration_tests.rs`. Tests every Rocket route against
a live MongoDB instance using Rocket's in-process `Client` (no TCP port).

Key patterns:
- **Shared runtime**: `LazyLock<Runtime>` keeps the MongoDB connection pool alive.
- **Shared client**: `LazyLock<Client>` (Rocket untracked test client), initialized once.
- **`TestUser` RAII**: Each test creates a `TestUser` whose `Drop` deletes it
  from the database (cleanup runs on a separate OS thread to avoid nested
  `block_on`).

### E2E / Playwright

```sh
cd app && npm run test:e2e
```

Located in `app/e2e/passwords.spec.js`. Drives headless Chromium through:
sign up → add passwords (generated + manual) → query & verify → change master
password → log out → log back in → re-verify → cleanup.

Playwright config (`app/playwright.config.js`) auto-starts both servers:
- Rocket API: `cargo run` on port 8000
- React dev server: `npm start` on port 3000

Use `--headed` to watch: `npx playwright test --headed`

## CI (GitHub Actions)

Workflow: `.github/workflows/ci.yml` — triggers on pushes/PRs to
main/master/passwords/master when `passwords/**` changes.

Three jobs:
1. **Rust Tests** — clippy + unit + integration (needs MongoDB secrets)
2. **JS Tests** — `npm run test:unit`
3. **E2E Tests** — builds API, installs Playwright Chromium, runs e2e

## Recent History

- **PR #23** (`4c467ef`): Added all four test suites (Rust unit, JS unit,
  Rust integration, Playwright e2e), refactored `lib.rs` out of `main.rs`,
  added `build_rocket()`, CI workflow, `test-helpers` feature, `TestUser`
  RAII pattern, README.
- **PR #24** (`7cc88ec`): Moved auth from JSON body to `x-username` /
  `x-password` headers, added Rocket `FromRequest` guard for `Credentials`.

## Conventions

- Rust: follow `cargo clippy -- -D warnings` (zero warnings policy).
- JS: CRA default ESLint rules.
- Tests should be deterministic; e2e tests run single-threaded (`workers: 1`).
- Integration tests must clean up after themselves (RAII `TestUser`).
- Prefer `thiserror` for library error types, `anyhow` for binary/main.
- CORS is handled by a Rocket fairing; the catch-all `OPTIONS` handler returns
  `204 No Content`.

## Agent Rules

When working in this codebase, always follow these rules:

### Test-Driven Development

- **Write tests first.** When adding a new feature or fixing a bug, start by
  writing a failing test that describes the expected behaviour, then write the
  code to make it pass.
- Run the relevant test suite(s) after every change to confirm nothing is
  broken. Use the commands listed in "Test Suites" above.
- When modifying existing behaviour, update or add tests *before* changing
  production code.

### Security

- **This is a password manager — treat every change as security-sensitive.**
- Never log, print, or expose plaintext passwords or master keys in any code
  path (including error messages and debug output).
- Never weaken cryptographic parameters (iteration counts, algorithm choices,
  key lengths) without an explicit user request and a clear justification.
- Always validate and sanitize inputs on both client and server.
- Do not introduce new dependencies without considering their security posture.
- **Stateless authentication**: Every request must include credentials via
  `x-username` / `x-password` headers. Never introduce cookies, sessions,
  JWTs, or any mechanism that persists a logged-in state. The client
  re-authenticates on every API call by design.

### Secrets & Environment Files

- **Never read, open, display, or include the contents of `.env` files.**
  They contain real database credentials. Refer to env var *names*
  (eg. `MONGO_USER`) but never their values.
- Do not commit secrets, tokens, or credentials to the repository.

### Keeping This File Up to Date

- If you discover that the architecture, routes, conventions, or any other
  section of this file is out of date, **update it as part of the current
  task** so future sessions start with accurate context.
- Avoid putting counts or quantities that change frequently (e.g. number of
  tests) in this file — they go stale quickly.

### Branching

- The main branch for this project is **`passwords/master`**.
- Feature branches should be named `xumaple/<feature>` when the user drives
  most of the work, or `xumaple/copilot/<feature>` when Copilot does the
  majority of the implementation.
- PRs should target `passwords/master`.
- For GitHub operations (creating PRs, issues, etc.), use the **`gh` CLI**
  (`brew install gh`). It is free and does not require a paid subscription.
  Do not rely on GitKraken/GitLens MCP tools for GitHub operations.

### General

- Prefer small, focused commits with clear intent.
- Follow the existing code style and patterns already in the codebase.
- When unsure about a design decision, look at how similar problems were
  solved elsewhere in the project before inventing a new pattern.
