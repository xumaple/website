// @ts-check
const { test, expect } = require("@playwright/test");

/**
 * MapoPass end-to-end test suite.
 *
 * Exercises the full user journey through the React frontend and Rocket API:
 *
 *   1. Create a new user with a random username / password.
 *   2. Create a bucket via the default "Add a new bucket" flow and capture
 *      its generated password.
 *   3. Add a bucket via the sidebar "Manually Add Passwords" modal.
 *   4. Open both buckets and verify their password fields are correct.
 *   5. Change the master password.
 *   6. Log out (clears browser-side state).
 *   7. Log back in with the new master password.
 *   8. Open both buckets again — confirm they survived the password change.
 *   9. Delete the test user via the API (cleanup).
 *
 * The tests run sequentially (test.describe.serial) because each step depends
 * on state created by the previous one.
 */

const API = "http://localhost:8000";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a random alphanumeric string of the given length. */
function randomString(len) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: len }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length))
  ).join("");
}

// ── Shared state across sequential steps ─────────────────────────────────────

/** Credentials and values that flow between test steps. */
const ctx = {
  username: `e2e_user_${randomString(10)}`,
  password: `E2ePass_${randomString(10)}`, // ≥ 13 chars
  /** SHA3-hashed username sent by the frontend to the API. Captured at sign-up. */
  hashedUsername: "",
  /** The key name for the auto-generated password. */
  generatedKey: `gen_key_${randomString(6)}`,
  /** The plaintext value of the auto-generated password (captured from API). */
  generatedPassword: "",
  /** The key name for the manually-added password. */
  manualKey: `manual_key_${randomString(6)}`,
  /** The plaintext value of the manually-added password. */
  manualPassword: `ManualPw_${randomString(10)}`,
  /** Key names for the bulk-added passwords. */
  bulkKey1: `bulk_key1_${randomString(6)}`,
  bulkKey2: `bulk_key2_${randomString(6)}`,
  /** Plaintext values for the bulk-added passwords. */
  bulkPassword1: `BulkPw1_${randomString(10)}`,
  bulkPassword2: `BulkPw2_${randomString(10)}`,
  /** The new master password after change. */
  newPassword: `NewPass_${randomString(10)}`, // ≥ 13 chars
};

// ── Test suite ───────────────────────────────────────────────────────────────

test.describe.serial("Full user journey", () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async ({ request }) => {
    // Always try to clean up the test user, even if a test failed.
    // The delete endpoint expects the same SHA3-hashed username that the
    // frontend sends during sign-up / login. We captured it in the create step.
    if (ctx.hashedUsername) {
      await request.delete(`${API}/api/v3/user`, {
        headers: {
          "x-username": ctx.hashedUsername,
          "x-password": "unused",
        },
      });
    }
    await page.close();
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 1: Create a new user
  // ────────────────────────────────────────────────────────────────────────
  test("create a new user", async () => {
    await page.goto("/");
    // Should see the sign-in view.
    await expect(page.getByText("Welcome to MapoPass")).toBeVisible();

    // Switch to "Sign up" mode by clicking the "here" link in
    // "First time? Sign up here."
    await page.locator("text=First time?").locator("span").click();

    // Wait for the view to switch (300ms loader delay in the app).
    await expect(page.getByRole("button", { name: "Sign up" })).toBeVisible();

    // Fill in credentials.
    await page.getByLabel("username").fill(ctx.username);
    await page.getByLabel("password").fill(ctx.password);

    // Intercept the sign-up request to capture the SHA3-hashed username the
    // frontend sends to the API. We need this for cleanup in afterAll.
    const signupPromise = page.waitForRequest(
      (req) =>
        req.url().endsWith("/api/v3/user") && req.method() === "POST"
    );

    // Submit.
    await page.getByRole("button", { name: "Sign up" }).click();

    // Extract the hashed username from the request headers.
    const signupReq = await signupPromise;
    ctx.hashedUsername = signupReq.headers()["x-username"];

    // After successful sign-up we land on the account view which shows
    // "Select a bucket to view:" in the query view.
    await expect(
      page.getByText("Select a bucket to view:")
    ).toBeVisible({ timeout: 15_000 });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 2: Create a bucket via the default "Add a new bucket" flow
  // ────────────────────────────────────────────────────────────────────────
  test("create a bucket with a generated password", async () => {
    // Click the FAB to switch to the "Add a new bucket" view.
    await page.getByRole("button", { name: "Add a new bucket" }).click();
    await expect(
      page.getByText("Enter a name for your new bucket!")
    ).toBeVisible();

    // Type the bucket name.
    await page.getByLabel("New bucket name").fill(ctx.generatedKey);

    // Intercept the /api/v3/generate response so we can capture the
    // generated password value before it gets AES-encrypted.
    const newPwPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/v3/generate") && resp.status() === 200
    );

    // Click "Create".
    await page.getByRole("button", { name: "Create" }).click();

    // Capture the generated plaintext password from the API response.
    const newPwResponse = await newPwPromise;
    ctx.generatedPassword = await newPwResponse.json();
    expect(ctx.generatedPassword.length).toBeGreaterThan(0);

    // The UI should now show "Bucket created with a new password!".
    await expect(
      page.getByText("Bucket created with a new password!")
    ).toBeVisible();
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 2b: Reject a too-long key in the generate flow
  // ────────────────────────────────────────────────────────────────────────
  test("reject a too-long key in generate flow", async () => {
    // We should still be in the new-bucket view from step 2.
    await expect(
      page.getByText("Enter a name for your new bucket!")
    ).toBeVisible();

    // Type a key that exceeds the 128-character limit.
    await page.getByLabel("New bucket name").fill("a".repeat(129));

    // The inline validation error should appear.
    await expect(
      page.getByText("Key is too long (max 128 characters).")
    ).toBeVisible({ timeout: 5_000 });

    // The Create button should be disabled.
    await expect(
      page.getByRole("button", { name: "Create" })
    ).toBeDisabled();

    // Clear the field so subsequent tests start clean.
    // Stay in new-bucket view — step 3 opens the drawer from here.
    await page.getByLabel("New bucket name").fill("");
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 3: Add a password via the sidebar "Manually Add Passwords" modal
  // ────────────────────────────────────────────────────────────────────────
  test("add a manual password via sidebar", async () => {
    // Open the drawer by clicking the user icon.
    await page.locator(".user").click();

    // Wait for the drawer to fully animate and the item to be stable.
    const manualAddBtn = page.getByText("Manually Add Passwords");
    await expect(manualAddBtn).toBeVisible();
    // MUI Drawer animates in — wait for animation to finish before clicking.
    await manualAddBtn.click({ timeout: 10_000 });

    // The modal should appear with "Manually Add Password" heading.
    await expect(
      page.getByRole("heading", { name: "Manually Add Password" })
    ).toBeVisible();

    // Fill in the key and password fields inside the modal.
    // Scope selectors to the modal dialog to avoid ambiguity with the
    // underlying "New bucket name" field.
    const modal = page.locator("[role='dialog']");
    await modal.getByLabel("key").fill(ctx.manualKey);
    await modal.getByLabel("password").fill(ctx.manualPassword);

    // Click "Save all" to upload.
    await modal.getByRole("button", { name: "Save all" }).click();

    // Wait for the upload to succeed — a green check icon appears.
    await expect(page.locator("[data-testid='CheckCircleIcon']")).toBeVisible({
      timeout: 10_000,
    });

    // The row disappears after a 2s delay. Wait for the green icon to vanish,
    // indicating the upload is fully complete and the modal can be closed.
    await expect(
      page.locator("[data-testid='CheckCircleIcon']")
    ).not.toBeVisible({ timeout: 10_000 });

    // Close the modal by pressing Escape.
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("heading", { name: "Manually Add Password" })
    ).not.toBeVisible({ timeout: 5_000 });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 3b: Reject a key that is too long in the manual-add modal
  // ────────────────────────────────────────────────────────────────────────
  test("reject a key that is too long", async () => {
    // Open the drawer and click "Manually Add Passwords".
    await page.locator(".user").click();
    const manualAddBtn = page.getByText("Manually Add Passwords");
    await expect(manualAddBtn).toBeVisible();
    await manualAddBtn.click({ timeout: 10_000 });

    await expect(
      page.getByRole("heading", { name: "Manually Add Password" })
    ).toBeVisible();

    // Fill in a key that exceeds the 128-character limit.
    const modal = page.locator("[role='dialog']");
    await modal.getByLabel("key").fill("a".repeat(129));

    // The inline validation error should appear on the key field.
    await expect(
      modal.getByText("Key is too long (max 128 characters).")
    ).toBeVisible({ timeout: 5_000 });

    // Close the modal.
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("heading", { name: "Manually Add Password" })
    ).not.toBeVisible({ timeout: 5_000 });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 3c: Add two passwords in bulk via the modal and verify both appear
  // ────────────────────────────────────────────────────────────────────────
  test("add multiple passwords in bulk — all show up without refresh", async () => {
    // Open the drawer and click "Manually Add Passwords".
    await page.locator(".user").click();
    const manualAddBtn = page.getByText("Manually Add Passwords");
    await expect(manualAddBtn).toBeVisible();
    await manualAddBtn.click({ timeout: 10_000 });

    await expect(
      page.getByRole("heading", { name: "Manually Add Password" })
    ).toBeVisible();

    const modal = page.locator("[role='dialog']");

    // Fill in the first key/password pair.
    await modal.getByLabel("key").fill(ctx.bulkKey1);
    await modal.getByLabel("password").fill(ctx.bulkPassword1);

    // Add a second row.
    await modal.getByRole("button", { name: "add another" }).click();

    // Fill in the second key/password pair — there are now two rows.
    const keyFields = modal.getByLabel("key");
    const pwFields = modal.getByLabel("password");
    await keyFields.nth(1).fill(ctx.bulkKey2);
    await pwFields.nth(1).fill(ctx.bulkPassword2);

    // Save both at once.
    await modal.getByRole("button", { name: "Save all" }).click();

    // Wait for both rows to finish uploading (both green check icons appear
    // then disappear after the 2s delay).
    await expect(page.locator("[data-testid='CheckCircleIcon']").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.locator("[data-testid='CheckCircleIcon']").first()
    ).not.toBeVisible({ timeout: 10_000 });

    // Close the modal.
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("heading", { name: "Manually Add Password" })
    ).not.toBeVisible({ timeout: 5_000 });

    // Switch to query view and confirm BOTH bulk keys are available in the
    // dropdown — without a page refresh. This is the regression check: before
    // the fix only the last-uploaded key appeared.
    await page
      .getByRole("button", { name: "View existing buckets" })
      .click();
    await expect(
      page.getByText("Select a bucket to view:")
    ).toBeVisible();

    // Open first bulk bucket.
    await queryAndVerifyPassword(page, ctx.bulkKey1, ctx.bulkPassword1);

    // Open second bulk bucket.
    await queryAndVerifyPassword(page, ctx.bulkKey2, ctx.bulkPassword2);

    // Switch back to new-bucket view so the rest of the suite (step 4) can
    // start from the right view.
    await page.getByRole("button", { name: "Add a new bucket" }).click();
    await expect(
      page.getByText("Enter a name for your new bucket!")
    ).toBeVisible();
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 4: Open both buckets and verify their passwords
  // ────────────────────────────────────────────────────────────────────────
  test("query both passwords", async () => {
    // Switch back to query view via the FAB.
    await page
      .getByRole("button", { name: "View existing buckets" })
      .click();
    await expect(
      page.getByText("Select a bucket to view:")
    ).toBeVisible();

    // --- Query the generated password ---
    await queryAndVerifyPassword(page, ctx.generatedKey, ctx.generatedPassword);

    // --- Query the manually-added password ---
    await queryAndVerifyPassword(page, ctx.manualKey, ctx.manualPassword);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 4b: Error message appears when a password query fails
  // ────────────────────────────────────────────────────────────────────────
  test("error message appears when bucket query fails", async () => {
    // We should be in the query view from step 4.
    await expect(
      page.getByText("Select a bucket to view:")
    ).toBeVisible();

    // The error div should be invisible initially — it has the -invis class
    // and its text color matches the background, so Playwright considers it
    // hidden. We verify the class is present and no visible error is shown.
    await expect(page.locator(".SignIn-error-invis")).toBeAttached();
    await expect(page.locator(".SignIn-error")).not.toBeAttached();

    // Intercept the next bucket fetch and abort it to simulate a failure.
    await page.route("**/api/v3/bucket/**", (route) => route.abort());

    // Selecting any bucket triggers a fresh API call (BucketView always
    // re-fetches on selection) that hits the route intercept above.
    const autocomplete = page.getByRole("combobox", {
      name: "Select a bucket",
    });
    await autocomplete.click();
    await autocomplete.fill("");
    await autocomplete.fill(ctx.bulkKey1);
    await page.getByRole("option", { name: ctx.bulkKey1 }).click();

    // The error message should appear.
    await expect(
      page.getByText("Unable to retrieve stored buckets at this time.")
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".SignIn-error")).toBeVisible();

    // Remove the route intercept so subsequent tests work normally.
    // Auto-clear after 10s is covered by the unit test (account.test.js).
    await page.unroute("**/api/v3/bucket/**");
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 5: Change the master password
  // ────────────────────────────────────────────────────────────────────────
  test("change master password", async () => {
    // Open the drawer and wait for animation.
    await page.locator(".user").click();
    const settingsBtn = page.getByText("Settings");
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click({ timeout: 10_000 });

    // The settings modal should appear.
    await expect(
      page.getByRole("heading", { name: "Edit Account Info" })
    ).toBeVisible();

    // Fill in new password twice. Use { exact: true } because "New Password"
    // is a substring of "Confirm New Password".
    await page
      .getByLabel("New Password", { exact: true })
      .fill(ctx.newPassword);
    await page.getByLabel("Confirm New Password").fill(ctx.newPassword);

    // Click Save.
    await page.getByRole("button", { name: "Save" }).click();

    // Wait for success message.
    await expect(page.getByText("Password updated successfully.")).toBeVisible({
      timeout: 15_000,
    });

    // Close the settings modal.
    await page.getByRole("button", { name: "Back" }).click();
    await expect(
      page.getByRole("heading", { name: "Edit Account Info" })
    ).not.toBeVisible();
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 6: Log out
  // ────────────────────────────────────────────────────────────────────────
  test("log out", async () => {
    // Open the drawer and wait for animation.
    await page.locator(".user").click();
    const logoutBtn = page.getByText("Log Out");
    await expect(logoutBtn).toBeVisible();
    await logoutBtn.click({ timeout: 10_000 });

    // Should return to the sign-in page.
    await expect(page.getByText("Welcome to MapoPass")).toBeVisible();
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 7: Log back in with the new password
  // ────────────────────────────────────────────────────────────────────────
  test("log back in with new password", async () => {
    await page.getByLabel("username").fill(ctx.username);
    await page.getByLabel("password").fill(ctx.newPassword);

    await page.getByRole("button", { name: "Log In" }).click();

    // Wait for the account view to load.
    await expect(
      page.getByText("Select a bucket to view:")
    ).toBeVisible({ timeout: 15_000 });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 8: Open buckets again — they should be unchanged
  // ────────────────────────────────────────────────────────────────────────
  test("passwords survive master password change", async () => {
    // Query the generated password.
    await queryAndVerifyPassword(page, ctx.generatedKey, ctx.generatedPassword);

    // Query the manually-added password.
    await queryAndVerifyPassword(page, ctx.manualKey, ctx.manualPassword);
  });
});

// ── Backwards-compatibility tests ───────────────────────────────────────────
//
// These tests verify that the permanent backcompat test user (created by the
// Rust `backcompat_setup` test) can still log in through the real UI and
// retrieve its stored passwords. The user was created with client-side hashed
// credentials (SHA-3 via encryptMaster), so logging in with the plaintext
// credentials exercises the full frontend crypto pipeline.

const BACKCOMPAT_PLAINTEXT_USER = "backcompat_test_user";
const BACKCOMPAT_PLAINTEXT_PW = "backcompat_password_123";
const BACKCOMPAT_EXPECTED_PASSWORDS = {
  email: "my_email_password",
  bank: "my_bank_password",
  social: "my_social_password",
};

test.describe.serial("Backwards compatibility", () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("backcompat user can log in through the UI", async () => {
    await page.goto("/");
    await expect(page.getByText("Welcome to MapoPass")).toBeVisible();

    // Fill in the plaintext credentials — the frontend hashes them via
    // encryptMaster() before sending to the API.
    await page.getByLabel("username").fill(BACKCOMPAT_PLAINTEXT_USER);
    await page.getByLabel("password").fill(BACKCOMPAT_PLAINTEXT_PW);

    await page.getByRole("button", { name: "Log In" }).click();

    // Wait for the account view to load.
    await expect(
      page.getByText("Select a bucket to view:")
    ).toBeVisible({ timeout: 15_000 });
  });

  test("backcompat user passwords decrypt to expected plaintext values", async () => {
    // Select each bucket from the dropdown, open it, and verify the
    // decrypted "password" field matches the expected plaintext.
    for (const [key, expectedPlaintext] of Object.entries(BACKCOMPAT_EXPECTED_PASSWORDS)) {
      await queryAndVerifyPassword(page, key, expectedPlaintext);
    }
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Select a bucket from the Autocomplete dropdown, wait for the BucketView to
 * load its fields, and verify the "password" field decrypts to the expected
 * value.
 *
 * Because decryption happens client-side via CryptoJS and verifying it in
 * Playwright would require duplicating the crypto logic, we instead use the
 * copy button on the "password" field row (sensitive values render as masked
 * dots, so the plaintext is only observable via the clipboard). We grant
 * clipboard permissions and read the copied value.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} key       - The bucket key name to select
 * @param {string} expected  - The expected plaintext value of the bucket's
 *                             "password" field
 */
async function queryAndVerifyPassword(page, key, expected) {
  // Grant clipboard-read permission so we can verify the copied value.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  // Target the combobox input specifically (MUI Autocomplete renders both
  // an input[role=combobox] and a ul[role=listbox] with the same label).
  const autocomplete = page.getByRole("combobox", {
    name: "Select a bucket",
  });
  await autocomplete.click();

  // Clear existing selection and type the key.
  await autocomplete.fill("");
  await autocomplete.fill(key);

  // Wait for the dropdown option to appear and click it.
  await page.getByRole("option", { name: key }).click();

  // The BucketView loads: its header shows the bucket key and each field is
  // rendered as a row. Wait for the "password" field's copy button.
  const copyButton = page.getByRole("button", { name: "copy password" });
  await expect(copyButton).toBeVisible({ timeout: 10_000 });

  // Click the copy icon to copy the password field's value to the clipboard.
  await copyButton.click();

  // The "Copied!" snackbar confirms the copy happened.
  await expect(page.getByText("Copied!")).toBeVisible({ timeout: 5_000 });

  // Read the clipboard and verify.
  const clipboardText = await page.evaluate(() =>
    navigator.clipboard.readText()
  );
  expect(clipboardText).toBe(expected);

  // Dismiss the snackbar so it doesn't overlap later assertions.
  await page.keyboard.press("Escape");
}
