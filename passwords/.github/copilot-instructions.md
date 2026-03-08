# MapoPass — Copilot Instructions

## Project Overview

MapoPass is a password manager with a **Rust/Axum API** backend and a
**React (CRA) + Electron** frontend. Passwords are encrypted client-side
before being sent to the server; the server never sees plaintext passwords.

The git root is one level up (`website/`), and this project lives under
`passwords/`. There is a sibling `blog/` directory in the same repo.
The repository is hosted on **GitHub** at `xumaple/website`.

## Architecture

### API (`api/`)

- **Framework**: Axum (async, with tower and tower-http)
- **Database**: MongoDB Atlas (via the `mongodb` crate)
- **Crypto**: `ring` (PBKDF2-HMAC-SHA512 for master key hashing, 100 000 iterations),
  `data-encoding` (hex encoding). Password generation via the `passwords` crate
  (renamed import `passwords_gen`).
- **Auth model**: Credentials (`x-username`, `x-password`) are sent as HTTP
  headers and extracted via an Axum `FromRequestParts` impl on `Credentials`.
  Username is hashed to a MongoDB ObjectId; master password is verified with
  PBKDF2.
- **Key types**: `UnencryptedMasterKey` → `MasterKey` type-state pattern
  enforces that a plaintext password must be hashed before storage or
  verification.
- **Library crate**: `lib.rs` exposes `build_router()` and public modules
  `db` and `encrypt`. `main.rs` is a thin launcher.
- **Test-only routes**: `DELETE /api/v2/user` is gated behind
  `#[cfg(any(test, debug_assertions, feature = "test-helpers"))]`.
- **Env vars**: `MONGO_USER`, `MONGO_PW`, `MONGO_ENDPOINT`,
  `USERS_DB_NAME`, `FRONTEND_ORIGIN` (loaded from `api/.env` locally, or
  from GitHub secrets in CI). All env vars are read lazily on first access
  via the `EnvVars` struct in `env.rs` — add new variables there rather
  than calling `std::env::var` directly. `FRONTEND_ORIGIN` should be a
  list of
  comma-separated allowed CORS origins. `USERS_DB_NAME` is the MongoDB
  database name.
- **CORS**: Handled by a tower-http `CorsLayer` built from the
  `FRONTEND_ORIGIN` env var.
- **Cargo feature**: `test-helpers` — enables the delete-user route for
  integration tests in release-like builds.

### Frontend (`app/`)

- **Framework**: React (Create React App), Material UI
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
| GET | `/passwords/{key}` | Header | Get single encrypted password |
| GET | `/passwords` | Header | Get all encrypted passwords |
| POST | `/passwords/{key}` | Header | Add encrypted password |
| PUT | `/passwords/{key}` | Header | Update encrypted password |
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

Located in `api/tests/integration_tests.rs`. Tests every Axum route against
a live MongoDB instance using Axum's in-process `Router` with
`tower::ServiceExt::oneshot` (no TCP port).

Key testing patterns:
- **Shared runtime**: A `LazyLock<Runtime>` keeps the MongoDB connection
  pool alive across all tests. Each `#[test]` calls `RT.block_on()`.
- **Shared router**: A `LazyLock<Router>` initialized once on the shared
  runtime; each request clones it (Axum routers are cheaply cloneable).
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
- Axum API: `cargo run` on port 8000
- React dev server: `npm start` on port 3000

Use `--headed` to watch: `npx playwright test --headed`

## CI (GitHub Actions)

Workflow: `.github/workflows/ci.yml` — triggers on pushes/PRs to
main/master/passwords/master when `passwords/**` changes.

Three jobs:
1. **Rust Tests** — clippy + unit + integration (needs MongoDB secrets)
2. **JS Tests** — `npm run test:unit`
3. **E2E Tests** — builds API, installs Playwright Chromium, runs e2e

## Conventions

- Rust: follow `cargo clippy -- -D warnings` (zero warnings policy).
- JS: CRA default ESLint rules.
- Tests should be deterministic; e2e tests run single-threaded (`workers: 1`).
- Integration tests must clean up after themselves (RAII `TestUser`).
- Prefer `thiserror` for library error types, `anyhow` for binary/main.
- CORS is handled by a tower-http `CorsLayer`; Axum handles `OPTIONS`
  preflight automatically.

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
- **Uniform error responses**: All API errors return `404 Not Found` with a
  generic message. This is intentional — varying status codes (e.g. 401 vs
  404) would let attackers enumerate valid usernames or password keys. Do
  not "fix" this by returning more specific error codes.

### Backwards Compatibility — Production Constraints

**This application is already running in production with real user data.**
Before changing any code that touches authentication, encryption, or data
storage, stop and think about whether existing users and their stored data
will still work after the change.

Some changes are **impossible** — for example, `encryptMaster()` is a
one-way hash (SHA-3 truncated to 16 chars) that produces the values sent as
`x-username` and `x-password` headers. There is no way to "migrate" a
one-way hash; if the algorithm changes, every existing user's credentials
become permanently invalid with no recovery path.

Other changes are **possible but require a careful migration** — for
example, server-side encryption schemes (PBKDF2 parameters, salt format)
or the way stored passwords are encrypted could theoretically be migrated
by reading old-format data, decrypting/re-encrypting, and writing it back
in the new format. But this requires a well-planned migration strategy,
potentially running old and new schemes in parallel, and must be executed
flawlessly since any bug means permanent data loss.

When proposing a change that affects crypto, auth, or data formats:
1. **Determine if the change is reversible or migratable.** Can existing
   data be converted to the new scheme? Or is it a one-way function whose
   output is already baked into stored data?
2. **If not migratable**, the change cannot be made (or must be additive —
   support both old and new schemes indefinitely).
3. **If migratable**, design the migration plan *before* writing any code.
   Call out the risks, the rollback strategy, and get explicit user
   approval before proceeding.

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
- **Write instructions that generalize.** When adding a new rule based on a
  specific situation, extract the underlying lesson rather than describing
  the exact scenario. Future agents should learn *how to think* about a
  class of problems, not memorize one instance. Use concrete examples to
  illustrate, but frame the rule broadly enough to cover similar situations.

### Branching

- The main branch for this project is **`passwords/master`**.
- Feature branches should be named `xumaple/<feature>` when the user drives
  most of the work, or `xumaple/copilot/<feature>` when Copilot does the
  majority of the implementation.
- PRs should target `passwords/master`.
- **Start from a clean base.** Before beginning new work, make sure you are
  on the main branch with the latest changes. If there are uncommitted
  changes, stash them first (`git stash`), switch to main and pull, then
  create the new feature branch and restore the stash if needed. Never
  start a feature branch from another unmerged feature branch unless
  intentionally stacking changes.
- For GitHub operations (creating PRs, issues, etc.), use the **`gh` CLI**
  (`brew install gh`). It is free and does not require a paid subscription.
  Do not rely on GitKraken/GitLens MCP tools for GitHub operations.
- **Use git worktrees for parallel work.** When working on a separate task
  (e.g. a docs PR while a feature branch is in progress), create a new
  worktree instead of switching branches in the main worktree. This avoids
  disrupting the user's working directory. Example:
  `git worktree add passwords-<feature> -b <branch>` (from the repo root).
  Worktrees must be placed inside the repo root, not as siblings.
  Subagents must always use a dedicated worktree — never switch branches
  or make commits in the user's main worktree.
- **Clean up worktrees when done.** After a branch is merged or a task is
  complete, remove the worktree (`git worktree remove passwords-<feature>`)
  and delete the local branch (`git branch -d <branch>`). Do not leave
  stale worktrees accumulating. When beginning a new session, check
  `git worktree list` and clean up any leftover worktrees from previous
  work whose branches have already been merged.

### Commits & PRs

- **Always ask the user for final confirmation** that they are happy with the
  changes before creating a commit.
- Once the user has confirmed and the commit is made, it is safe to push and
  open a PR if the user has expressed that intent — but check first whether
  they want to combine multiple commits into a single PR.
- **Use separate commits for distinct changes.** When fixing a bug discovered
  during development of a feature, create a new commit rather than amending
  the feature commit. This keeps the history readable and makes review easier.
  Only amend a commit when the change is a trivial correction to that same
  commit (e.g. a typo introduced in the same diff). If the change has its
  own logical purpose — such as a bug fix, a config tweak, or a refactor
  prompted by feedback — it deserves its own commit.

### Delegating to Subagents

- **Delegate aggressively to preserve context window.** The main agent's
  token budget is finite and precious. Kick off code changes, debugging,
  and research to subagents as early as possible — don't burn tokens
  investigating a problem yourself before deciding to delegate. Gather
  only the minimum context needed to write a good subagent prompt (e.g.
  which CI job failed, the error message), then hand it off immediately.
- **Always point subagents at this file.** When spawning a subagent, tell
  it to read `passwords/.github/copilot-instructions.md` and follow all
  rules — especially security, uniform error responses, and branching.
  Never override project conventions by providing exact code in the prompt;
  describe *what* needs to happen and let the subagent derive the
  implementation from the codebase and these instructions.
- **Subagents may spawn their own subagents.** If a subagent decides a
  subtask is complex enough to delegate further, that is fine — the same
  rules apply recursively.

### General

- Prefer small, focused commits with clear intent.
- Follow the existing code style and patterns already in the codebase.
- When unsure about a design decision, look at how similar problems were
  solved elsewhere in the project before inventing a new pattern.

### Coding Tips

- **Axum layer ordering**: In Axum, `.layer(...)` only wraps routes that
  were added **before** the layer call. If a route is added *after*
  `.layer()`, the middleware will not apply to it — leading to subtle bugs.
  Always apply shared layers (CORS, tracing, rate limiting) after all routes
  have been registered, including conditional `#[cfg(...)]` routes.
- **Use Rust's type system, not stringly-typed catch-alls.** Each distinct
  error condition should be its own enum variant with a descriptive name
  (e.g. `MissingCredentials`, `KeyTooLong`), not a generic variant like
  `Rejection(&'static str)` reused across unrelated call sites. Variant
  names should describe *what went wrong*, and `#[error("...")]` messages
  should provide enough context for logs to be useful — the `IntoResponse`
  impl logs this before returning the uniform 404. When an inner error
  exists, use `#[from]` to wrap it (see `CryptoError`, `DbError`).
