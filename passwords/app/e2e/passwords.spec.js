// @ts-check
const { test, expect } = require("@playwright/test");

/**
 * MapoPass end-to-end test suite.
 *
 * Exercises the full user journey through the React frontend and Rocket API:
 *
 *   1. Create a new user with a random username / password.
 *   2. Create an account via "Add a new account" using the [Generate] button
 *      and capture the generated password.
 *   3. Create an account with a typed password.
 *   4. Create accounts with extra details (email) in the same view, several
 *      in a row without a refresh.
 *   5. Open the accounts and verify their passwords (and details) via the
 *      click-to-copy box.
 *   6. Manage an account: add / edit / delete a detail.
 *   7. Change the master password.
 *   8. Log out (clears browser-side state).
 *   9. Log back in with the new master password.
 *  10. Open the accounts again — confirm they survived the password change.
 *  11. Delete the test user via the API (cleanup).
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
  /** The account name for the generated-password account. */
  generatedKey: `gen_key_${randomString(6)}`,
  /** The plaintext value of the generated password (read from the form). */
  generatedPassword: "",
  /** The account name for the typed-password account. */
  manualKey: `manual_key_${randomString(6)}`,
  /** The plaintext value of the typed password. */
  manualPassword: `ManualPw_${randomString(10)}`,
  /** Account names for the multi-account / extra-detail steps. */
  bulkKey1: `bulk_key1_${randomString(6)}`,
  bulkKey2: `bulk_key2_${randomString(6)}`,
  /** Plaintext passwords for the bulk accounts. */
  bulkPassword1: `BulkPw1_${randomString(10)}`,
  bulkPassword2: `BulkPw2_${randomString(10)}`,
  /** A non-secret extra detail stored on bulkKey1. */
  emailDetail: `${randomString(8)}@example.com`,
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
    // "Select an account to retrieve:" in the query view.
    await expect(page.getByText("Select an account to retrieve:")).toBeVisible({
      timeout: 30_000,
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 2: Create an account using the [Generate] button
  // ────────────────────────────────────────────────────────────────────────
  test("create an account with a generated password", async () => {
    // Click the FAB to switch to the "Add a new account" view.
    await page.getByRole("button", { name: "Add a new account" }).click();
    await expect(page.getByText("Add a new account:")).toBeVisible();

    // Type the account name.
    await page.getByLabel("Account name").fill(ctx.generatedKey);

    // The password detail is the pre-added first row of the detail list,
    // and its value arrives pre-populated with a generated password.
    const passwordRow = page.getByTestId("new-detail-0");
    await expect(passwordRow.getByLabel("label", { exact: true })).toHaveValue(
      "password"
    );
    const passwordValue = passwordRow.getByLabel("value", { exact: true });
    await expect(passwordValue).not.toHaveValue("", { timeout: 30_000 });

    // Clear it and click the row's [Generate] to re-roll, so we verify the
    // button and know exactly which value we captured.
    await passwordValue.fill("");
    await passwordRow.getByRole("button", { name: "Generate" }).click();
    await expect(passwordValue).not.toHaveValue("", {
      timeout: 30_000,
    });
    ctx.generatedPassword = await passwordValue.inputValue();
    expect(ctx.generatedPassword.length).toBeGreaterThan(0);

    // Create the account.
    await page.getByRole("button", { name: "Create account" }).click();

    // The click-to-copy box should appear.
    await expect(
      page.getByText(`Created ${ctx.generatedKey}!`)
    ).toBeVisible({ timeout: 30_000 });

    // Verify the copy box actually copies the generated password.
    await page.context().grantPermissions([
      "clipboard-read",
      "clipboard-write",
    ]);
    const clipboardText = await clickToCopy(
      page,
      "Click here to copy the password."
    );
    expect(clipboardText).toBe(ctx.generatedPassword);

    // The confirmation snackbar names what was copied.
    await expect(
      page.getByText(`Copied password for ${ctx.generatedKey}!`)
    ).toBeVisible();

    // The form resets so more accounts can be added in a row: the name is
    // cleared and a single fresh password row is pre-added — and pre-filled
    // with a newly generated password.
    await expect(page.getByLabel("Account name")).toHaveValue("");
    const resetRow = page.getByTestId("new-detail-0");
    await expect(resetRow.getByLabel("label", { exact: true })).toHaveValue(
      "password"
    );
    await expect(resetRow.getByLabel("value", { exact: true })).not.toHaveValue(
      "",
      { timeout: 30_000 }
    );
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 2b: Reject a too-long account name
  // ────────────────────────────────────────────────────────────────────────
  test("reject a too-long account name", async () => {
    // We should still be in the new-account view from step 2.
    await expect(page.getByText("Add a new account:")).toBeVisible();

    // Type a name that exceeds the 128-character limit.
    await page.getByLabel("Account name").fill("a".repeat(129));

    // The inline validation error should appear.
    await expect(
      page.getByText("Account name is too long (max 128 characters).")
    ).toBeVisible({ timeout: 5_000 });

    // The Create account button should be disabled.
    await expect(
      page.getByRole("button", { name: "Create account" })
    ).toBeDisabled();

    // Clear the field so subsequent tests start clean.
    await page.getByLabel("Account name").fill("");
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 3: Create an account with a typed password
  // ────────────────────────────────────────────────────────────────────────
  test("create an account with a typed password", async () => {
    await expect(page.getByText("Add a new account:")).toBeVisible();

    await page.getByLabel("Account name").fill(ctx.manualKey);
    await page
      .getByTestId("new-detail-0")
      .getByLabel("value", { exact: true })
      .fill(ctx.manualPassword);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText(`Created ${ctx.manualKey}!`)).toBeVisible({
      timeout: 30_000,
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 3b: Create accounts with extra details, several in a row
  // ────────────────────────────────────────────────────────────────────────
  test("create accounts with extra details in a row", async () => {
    await expect(page.getByText("Add a new account:")).toBeVisible();

    // First account: password + a non-secret email detail, each a uniform row.
    await page.getByLabel("Account name").fill(ctx.bulkKey1);
    await page
      .getByTestId("new-detail-0")
      .getByLabel("value", { exact: true })
      .fill(ctx.bulkPassword1);
    await page.getByRole("button", { name: "+ Add another detail" }).click();
    const emailRow = page.getByTestId("new-detail-1");
    await emailRow.getByLabel("label", { exact: true }).fill("email");
    await emailRow.getByLabel("value", { exact: true }).fill(ctx.emailDetail);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText(`Created ${ctx.bulkKey1}!`)).toBeVisible({
      timeout: 30_000,
    });

    // Second account created immediately after — the form has reset.
    await page.getByLabel("Account name").fill(ctx.bulkKey2);
    await page
      .getByTestId("new-detail-0")
      .getByLabel("value", { exact: true })
      .fill(ctx.bulkPassword2);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText(`Created ${ctx.bulkKey2}!`)).toBeVisible({
      timeout: 30_000,
    });

    // Switch to the query view and confirm both accounts are available
    // without a page refresh (regression check for the shared keys state).
    await page.getByRole("button", { name: "View accounts" }).click();
    await expect(page.getByText("Select an account to retrieve:")).toBeVisible();

    await queryAndVerifyPassword(page, ctx.bulkKey1, ctx.bulkPassword1);
    await queryAndVerifyPassword(page, ctx.bulkKey2, ctx.bulkPassword2);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 4: Open both accounts and verify their passwords
  // ────────────────────────────────────────────────────────────────────────
  test("query both passwords", async () => {
    await expect(page.getByText("Select an account to retrieve:")).toBeVisible();

    // --- The generated-password account ---
    await queryAndVerifyPassword(page, ctx.generatedKey, ctx.generatedPassword);

    // --- The typed-password account ---
    await queryAndVerifyPassword(page, ctx.manualKey, ctx.manualPassword);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 4b: Non-secret details show their value inline and copy on click
  // ────────────────────────────────────────────────────────────────────────
  test("non-secret detail shows inline and copies", async () => {
    await selectAccount(page, ctx.bulkKey1);

    // The password chip is preselected; click the email chip.
    await page.getByRole("button", { name: "email", exact: true }).click();

    // The copy box shows the detail label and the value inline.
    await expect(
      page.getByText(`Retrieved email for ${ctx.bulkKey1}!`)
    ).toBeVisible();
    await expect(page.getByText(ctx.emailDetail)).toBeVisible();

    // Clicking the box copies the value.
    await page.context().grantPermissions([
      "clipboard-read",
      "clipboard-write",
    ]);
    const clipboardText = await clickToCopy(page);
    expect(clipboardText).toBe(ctx.emailDetail);

    // The confirmation snackbar names what was copied.
    await expect(
      page.getByText(`Copied email for ${ctx.bulkKey1}!`)
    ).toBeVisible();
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 4c: Manage an account — add, edit, and delete a detail
  // ────────────────────────────────────────────────────────────────────────
  test("manage an account: add, edit, delete a detail", async () => {
    await selectAccount(page, ctx.bulkKey2);

    // Expand the management panel.
    await page.getByRole("button", { name: "Manage this account" }).click();
    await expect(
      page.getByRole("button", { name: "Rename account" })
    ).toBeVisible();

    // --- Add a non-secret "username" detail ---
    await page.getByRole("button", { name: "Add a detail" }).click();
    await page.getByLabel("label", { exact: true }).fill("username");
    await page.getByLabel("value", { exact: true }).fill("my_user_1");
    await page.getByRole("button", { name: "Add", exact: true }).click();

    // The new detail appears as a chip and as a management row.
    await expect(
      page.getByRole("button", { name: "username", exact: true })
    ).toBeVisible({ timeout: 30_000 });
    const usernameRow = page.getByTestId("detail-row-username");
    await expect(usernameRow).toContainText("my_user_1");

    // --- Edit the detail in place ---
    await usernameRow.getByRole("button", { name: "Edit" }).click();
    await usernameRow.getByRole("textbox").fill("my_user_2");
    await usernameRow.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("detail-row-username")).toContainText(
      "my_user_2",
      { timeout: 30_000 }
    );

    // --- Delete the detail (accepting the confirm dialog) ---
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByTestId("detail-row-username")
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(page.getByTestId("detail-row-username")).not.toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("button", { name: "username", exact: true })
    ).not.toBeVisible();
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 4c2: Rename an account — panel stays open, selector updates
  // ────────────────────────────────────────────────────────────────────────
  test("rename an account keeps the panel open and updates the selector", async () => {
    // The management panel for bulkKey2 is still open from the previous test.
    await page.getByRole("button", { name: "Rename account" }).click();

    const renamedKey = `renamed_${randomString(6)}`;
    await page.getByLabel("New account name").fill(renamedKey);
    await page.getByRole("button", { name: "Save", exact: true }).click();

    // The management panel stays open, now showing the renamed account.
    await expect(
      page.getByRole("button", { name: "Rename account" })
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("detail-row-password")).toBeVisible();
    await expect(
      page.getByText(`Retrieved password for ${renamedKey}!`)
    ).toBeVisible();

    // The account selector shows the new name immediately.
    await expect(
      page.getByRole("combobox", { name: "Select an account" })
    ).toHaveValue(renamedKey);

    ctx.bulkKey2 = renamedKey;
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 4d: Error message appears when an account query fails
  // ────────────────────────────────────────────────────────────────────────
  test("error message appears when account query fails", async () => {
    // The error div should be invisible initially — it has the -invis class
    // and its text color matches the background, so Playwright considers it
    // hidden. We verify the class is present and no visible error is shown.
    await expect(page.locator(".SignIn-error-invis")).toBeAttached();
    await expect(page.locator(".SignIn-error")).not.toBeAttached();

    // Intercept the next account fetch and abort it to simulate a failure.
    await page.route("**/api/v3/bucket/**", (route) => route.abort());

    // Selecting any account triggers a fresh API call (the account view
    // always re-fetches on selection) that hits the intercept above.
    const autocomplete = page.getByRole("combobox", {
      name: "Select an account",
    });
    await autocomplete.click();
    await autocomplete.fill("");
    await autocomplete.fill(ctx.bulkKey1);
    await page.getByRole("option", { name: ctx.bulkKey1 }).click();

    // The error message should appear.
    await expect(
      page.getByText("Unable to retrieve this account at this time.")
    ).toBeVisible({ timeout: 30_000 });
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
    await settingsBtn.click({ timeout: 30_000 });

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

    // Click Change Password.
    await page.getByRole("button", { name: "Change Password" }).click();

    // Wait for success message.
    await expect(page.getByText("Password updated successfully.")).toBeVisible({
      timeout: 30_000,
    });

    // Close the settings modal.
    await page.getByRole("button", { name: "Close settings" }).click();
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
    await logoutBtn.click({ timeout: 30_000 });

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
    await expect(page.getByText("Select an account to retrieve:")).toBeVisible({
      timeout: 30_000,
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Step 8: Open accounts again — they should be unchanged
  // ────────────────────────────────────────────────────────────────────────
  test("passwords survive master password change", async () => {
    // The generated-password account.
    await queryAndVerifyPassword(page, ctx.generatedKey, ctx.generatedPassword);

    // The typed-password account.
    await queryAndVerifyPassword(page, ctx.manualKey, ctx.manualPassword);
  });
});

// ── Backwards-compatibility tests ───────────────────────────────────────────
//
// These tests verify that the permanent backcompat test user (created by the
// Rust `backcompat_setup` test) can still log in through the real UI and
// retrieve its stored passwords. The user was created with client-side hashed
// credentials (SHA-3 via encryptMaster), so logging in with the plaintext
// credentials exercises the full frontend crypto pipeline. Its legacy flat
// passwords are expected to surface as accounts holding a single "password"
// detail.

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
    await expect(page.getByText("Select an account to retrieve:")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("backcompat user passwords decrypt to expected plaintext values", async () => {
    // Select each account from the dropdown, open it, and verify the
    // decrypted "password" detail matches the expected plaintext.
    for (const [key, expectedPlaintext] of Object.entries(BACKCOMPAT_EXPECTED_PASSWORDS)) {
      await queryAndVerifyPassword(page, key, expectedPlaintext);
    }
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Select an account in the Autocomplete dropdown and wait for its view
 * (chips + copy box) to load.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} key - The account name to select
 */
async function selectAccount(page, key) {
  // Target the combobox input specifically (MUI Autocomplete renders both
  // an input[role=combobox] and a ul[role=listbox] with the same label).
  const autocomplete = page.getByRole("combobox", {
    name: "Select an account",
  });

  // Clear any existing selection, type the key, and pick the matching
  // dropdown option. The MUI Autocomplete occasionally misses a programmatic
  // fill and reports "No options", so retry the whole sequence.
  for (let attempt = 0; ; attempt++) {
    await autocomplete.click();
    await autocomplete.fill("");
    await autocomplete.fill(key);
    try {
      await page.getByRole("option", { name: key }).click({ timeout: 10_000 });
      break;
    } catch (e) {
      if (attempt >= 2) {
        throw e;
      }
    }
  }

  // Wait for the copy box, which signals the account finished loading.
  await expect(page.getByText(`for ${key}!`)).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * Select an account, then verify its "password" detail decrypts to the
 * expected value via the click-to-copy box.
 *
 * Because decryption happens client-side via CryptoJS and verifying it in
 * Playwright would require duplicating the crypto logic, we use the copy box
 * (secret values are never displayed, only copied). We grant clipboard
 * permissions and read the copied value.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} key       - The account name to select
 * @param {string} expected  - The expected plaintext of the password detail
 */
async function queryAndVerifyPassword(page, key, expected) {
  // Grant clipboard-read permission so we can verify the copied value.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  await selectAccount(page, key);

  // The password detail is preselected, so the copy box shows it directly.
  await expect(
    page.getByText(`Retrieved password for ${key}!`)
  ).toBeVisible({ timeout: 30_000 });

  // Click the box to copy the password to the clipboard and verify.
  const clipboardText = await clickToCopy(page);
  expect(clipboardText).toBe(expected);
}

/**
 * Click the copy box and return the clipboard contents.
 *
 * The clipboard is cleared first, and the click is retried if nothing was
 * copied (a click can be swallowed by an in-flight re-render), so a stale
 * value from an earlier copy is never mistaken for this one. A wrong copied
 * value still fails the caller's assertion.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string>} the copied text
 */
async function clickToCopy(page, copyText = "Click here to copy.") {
  await page.evaluate(() => navigator.clipboard.writeText(""));
  let clipboardText = "";
  for (let attempt = 0; attempt < 5 && clipboardText === ""; attempt++) {
    await page.getByText(copyText).click();
    await page.waitForTimeout(200);
    clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  }
  return clipboardText;
}
