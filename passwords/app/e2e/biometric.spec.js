// @ts-check
const { test, expect } = require("@playwright/test");

/**
 * Biometric (Touch ID / Face ID) unlock e2e suite.
 *
 * Uses Chromium's CDP virtual authenticator — a CTAP2 "internal" (platform)
 * authenticator with PRF support and user verification always passing — to
 * stand in for Touch ID:
 *
 *   1. Create a new user — the post-login offer appears; decline it.
 *   2. Enable biometric unlock in Settings (creates the passkey); the
 *      button flips to a disabled "enabled" state with an X to turn off.
 *   3. Log out, then sign back in via the "Use …" button — logging out
 *      must NOT auto-fire the prompt.
 *   4. Reload the page — auto-unlock signs in with zero clicks.
 *   5. Change the master password — enrollment must be cleared, and the
 *      unlock button must be gone after logging out.
 *   6. Log in and enable via the post-login offer's Enable button.
 *   7. Turn biometrics off via the X in settings.
 *   8. Ignore the offer, enable in settings instead — the offer must be
 *      gone when settings closes.
 *   9. Delete the test user via the API (cleanup).
 */

const API = "http://localhost:8000";

/** Generate a random alphanumeric string of the given length. */
function randomString(len) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: len }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length))
  ).join("");
}

const ctx = {
  username: `e2e_bio_${randomString(10)}`,
  password: `BioPass_${randomString(10)}`, // ≥ 13 chars
  newPassword: `BioNewPw_${randomString(10)}`, // ≥ 13 chars
  /** SHA3-hashed username sent by the frontend to the API. Captured at sign-up. */
  hashedUsername: "",
};

test.describe.serial("Biometric unlock journey", () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    // Install a virtual platform authenticator with PRF (hmac-secret).
    const client = await page.context().newCDPSession(page);
    await client.send("WebAuthn.enable");
    await client.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        hasPrf: true,
        automaticPresenceSimulation: true,
      },
    });
  });

  test.afterAll(async ({ request }) => {
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

  test("create a new user", async () => {
    await page.goto("/");
    await expect(page.getByText("Welcome to MapoPass")).toBeVisible();
    await page.locator("text=First time?").locator("span").click();
    await expect(page.getByRole("button", { name: "Sign up" })).toBeVisible();

    await page.getByLabel("username").fill(ctx.username);
    await page.getByLabel("password").fill(ctx.password);

    const signupPromise = page.waitForRequest(
      (req) => req.url().endsWith("/api/v3/user") && req.method() === "POST"
    );
    await page.getByRole("button", { name: "Sign up" }).click();
    const signupRequest = await signupPromise;
    ctx.hashedUsername = signupRequest.headers()["x-username"];

    await expect(
      page.getByRole("button", { name: "Add a new account" })
    ).toBeVisible();

    // The post-login offer appears for un-enrolled users; decline it.
    await expect(
      page.getByText(/Use (Touch ID|Face ID|biometrics) instead of your password/)
    ).toBeVisible();
    await page.getByRole("button", { name: "Not now" }).click();
    await expect(
      page.getByText(/Use (Touch ID|Face ID|biometrics) instead of your password/)
    ).not.toBeVisible();
  });

  test("enable biometric unlock in settings", async () => {
    await page.locator(".Account-dropdown .user").click();
    await page.getByText("Settings").click();

    const enableButton = page.getByRole("button", {
      name: /^Use (Touch ID|Face ID|biometrics)$/,
    });
    await expect(enableButton).toBeVisible();
    await enableButton.click();

    // The button flips to a disabled "enabled" state with an X to turn off.
    await expect(
      page.getByRole("button", {
        name: /(Touch ID|Face ID|biometrics) enabled/,
      })
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: /Turn off/ })
    ).toBeVisible();
    await page.getByRole("button", { name: "Close settings" }).click();
  });

  test("log out and unlock with biometrics", async () => {
    await page.locator(".Account-dropdown .user").click();
    await page.getByText("Log Out").click();
    await expect(page.getByText("Welcome to MapoPass")).toBeVisible();

    const unlockButton = page.getByRole("button", {
      name: /Use (Touch ID|Face ID|biometrics)/,
    });
    await expect(unlockButton).toBeVisible();

    // Logging out must not auto-fire the prompt (once-per-page-load rule):
    // with automaticPresenceSimulation on, an auto-fired prompt would sign
    // us straight back in. Verify we stay signed out.
    await page.waitForTimeout(1500);
    await expect(page.getByText("Welcome to MapoPass")).toBeVisible();

    await unlockButton.click();

    // Signed in without typing anything.
    await expect(
      page.getByRole("button", { name: "Add a new account" })
    ).toBeVisible();
    // Enrolled users don't get the post-login offer.
    await expect(
      page.getByText(/Use (Touch ID|Face ID|biometrics) instead of your password/)
    ).not.toBeVisible();
  });

  test("reloading the page auto-unlocks with zero clicks", async () => {
    await page.reload();
    // The virtual authenticator auto-approves, so the auto-fired prompt
    // signs us in without touching the form.
    await expect(
      page.getByRole("button", { name: "Add a new account" })
    ).toBeVisible();
  });

  test("changing the master password clears the enrollment", async () => {
    await page.locator(".Account-dropdown .user").click();
    await page.getByText("Settings").click();

    // { exact: true } because "New Password" is a substring of
    // "Confirm New Password".
    await page.getByLabel("New Password", { exact: true }).fill(ctx.newPassword);
    await page.getByLabel("Confirm New Password").fill(ctx.newPassword);
    await page.getByRole("button", { name: "Change Password" }).click();

    await expect(
      page.getByText(/was turned off/)
    ).toBeVisible({ timeout: 30_000 });
    // The biometric button is back to its clickable un-enrolled state.
    await expect(
      page.getByRole("button", {
        name: /^Use (Touch ID|Face ID|biometrics)$/,
      })
    ).toBeEnabled();
    await page.getByRole("button", { name: "Close settings" }).click();

    // After logging out the unlock button must be gone.
    await page.locator(".Account-dropdown .user").click();
    await page.getByText("Log Out").click();
    await expect(page.getByText("Welcome to MapoPass")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Use (Touch ID|Face ID|biometrics)/ })
    ).not.toBeVisible();

    // And the new password still works.
    await page.getByLabel("username").fill(ctx.username);
    await page.getByLabel("password").fill(ctx.newPassword);
    await page.getByRole("button", { name: "Log In" }).click();
    await expect(
      page.getByRole("button", { name: "Add a new account" })
    ).toBeVisible();
  });

  test("enable via the post-login offer", async () => {
    // The offer was declined in step 1 ("Not now" persists); un-dismiss it
    // to test the Enable path.
    await page.evaluate(() =>
      localStorage.removeItem("mapopass.biometric.promo-dismissed")
    );
    await page.locator(".Account-dropdown .user").click();
    await page.getByText("Log Out").click();
    await page.getByLabel("username").fill(ctx.username);
    await page.getByLabel("password").fill(ctx.newPassword);
    await page.getByRole("button", { name: "Log In" }).click();

    await expect(
      page.getByText(/Use (Touch ID|Face ID|biometrics) instead of your password/)
    ).toBeVisible();
    await page.getByRole("button", { name: "Enable" }).click();
    await expect(
      page.getByText(/(Touch ID|Face ID|biometrics) turned on/)
    ).toBeVisible();

    // The enrollment is live: the unlock button is back after logging out.
    await page.locator(".Account-dropdown .user").click();
    await page.getByText("Log Out").click();
    await expect(
      page.getByRole("button", { name: /Use (Touch ID|Face ID|biometrics)/ })
    ).toBeVisible();
  });

  test("turn off via the X in settings", async () => {
    // Unlock (manual click — the page-load auto-attempt was already spent),
    // then disable from settings via the X next to the enabled button.
    await page
      .getByRole("button", { name: /Use (Touch ID|Face ID|biometrics)/ })
      .click();
    await expect(
      page.getByRole("button", { name: "Add a new account" })
    ).toBeVisible();

    await page.locator(".Account-dropdown .user").click();
    await page.getByText("Settings").click();
    await expect(
      page.getByRole("button", {
        name: /(Touch ID|Face ID|biometrics) enabled/,
      })
    ).toBeDisabled();
    await page.getByRole("button", { name: /Turn off/ }).click();

    // Back to the clickable un-enrolled state.
    await expect(
      page.getByRole("button", {
        name: /^Use (Touch ID|Face ID|biometrics)$/,
      })
    ).toBeEnabled();
    await page.getByRole("button", { name: "Close settings" }).click();

    // Enrollment is gone: no unlock button after logging out.
    await page.locator(".Account-dropdown .user").click();
    await page.getByText("Log Out").click();
    await expect(page.getByText("Welcome to MapoPass")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Use (Touch ID|Face ID|biometrics)/ })
    ).not.toBeVisible();
  });

  test("offer retires itself after enabling in settings", async () => {
    // Log in un-enrolled and un-dismissed: the offer appears.
    await page.getByLabel("username").fill(ctx.username);
    await page.getByLabel("password").fill(ctx.newPassword);
    await page.getByRole("button", { name: "Log In" }).click();
    await expect(
      page.getByText(/Use (Touch ID|Face ID|biometrics) instead of your password/)
    ).toBeVisible();

    // Ignore it; enable from settings instead.
    await page.locator(".Account-dropdown .user").click();
    await page.getByText("Settings").click();
    await page
      .getByRole("button", { name: /^Use (Touch ID|Face ID|biometrics)$/ })
      .click();
    await expect(
      page.getByRole("button", {
        name: /(Touch ID|Face ID|biometrics) enabled/,
      })
    ).toBeDisabled();
    await page.getByRole("button", { name: "Close settings" }).click();

    // The stale offer must not resurface.
    await expect(
      page.getByText(/Use (Touch ID|Face ID|biometrics) instead of your password/)
    ).not.toBeVisible();
  });
});
