# MapoPass — Test Suite

Tests for the MapoPass password manager, covering unit-level crypto through
full browser-driven flows.

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Rust | 1.70+ | `cargo` on PATH |
| Node.js | 18+ | `npm` on PATH |
| MongoDB | — | Credentials in `api/.env` |
| Chromium (Playwright) | — | `npx playwright install chromium` |

## Rust Unit Tests

Unit tests for the API's crypto (`encrypt.rs`) and database (`db.rs`) modules:
PBKDF2 key derivation, MasterKey type-state verification, OID generation,
serialization, and error handling.

```sh
cd api/
cargo test --lib
```

## JavaScript Unit Tests

Fast, isolated tests for the client-side crypto helpers (`encrypt.js`):
hashing, AES encrypt/decrypt, master-password change logic, and a regression
test for the key-mismatch bug.

```sh
cd app/
npm run test:unit
```

## Rust Integration Tests

Tests every Rocket API route against a real MongoDB instance using Rocket's
in-process `Client` (no TCP port needed). A shared `LazyLock<Runtime>` keeps
the connection pool alive, and `TestUser` RAII guards auto-delete test users.

```sh
cd api/
cargo test --test integration_tests
```

## End-to-End (Playwright)

Drives a headless Chromium browser through the full user journey: sign up →
add passwords (generated + manual) → query & verify → change master password →
log out → log back in → re-verify passwords → cleanup.

The Playwright config auto-starts both the Rocket API (`cargo run`, port 8000)
and the React dev server (`npm start`, port 3000). If they're already running,
it reuses them (except in CI).

```sh
cd app/
npm run test:e2e
```

### Running headed (to watch the browser)

```sh
cd app/
npx playwright test --headed
```

## All Tests at a Glance

| Suite | Location | Count | Command |
|-------|----------|-------|---------|
| Rust unit | `api/src/{encrypt,db}.rs` | 29 | `cargo test --lib` |
| JS unit | `app/src/crypto/encrypt.test.js` | 17 | `npm run test:unit` |
| Rust integration | `api/tests/integration_tests.rs` | 18 | `cargo test --test integration_tests` |
| E2E (Playwright) | `app/e2e/passwords.spec.js` | 8 | `npm run test:e2e` |
