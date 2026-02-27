import {
  encryptMaster,
  encryptPw,
  decryptPw,
  shaHash,
  checkPassword,
  PW_MIN_LEN,
} from "./encrypt";

describe("encryptMaster", () => {
  test("returns a 16-character hex string", () => {
    const result = encryptMaster("mypassword");
    expect(result).toHaveLength(16);
  });

  test("is deterministic", () => {
    expect(encryptMaster("hello")).toBe(encryptMaster("hello"));
  });

  test("different inputs produce different outputs", () => {
    expect(encryptMaster("password1")).not.toBe(encryptMaster("password2"));
  });
});

describe("shaHash", () => {
  test("is deterministic", () => {
    expect(shaHash("test")).toBe(shaHash("test"));
  });

  test("different inputs produce different hashes", () => {
    expect(shaHash("a")).not.toBe(shaHash("b"));
  });

  test("returns a hex string", () => {
    expect(shaHash("test")).toMatch(/^[0-9a-f]+$/);
  });
});

describe("encryptPw / decryptPw round-trip", () => {
  test("decrypt recovers the original password", () => {
    const masterPassword = "my_master_password";
    const storedPassword = "s3cret_site_pw!";

    const encrypted = encryptPw(masterPassword, storedPassword);
    const decrypted = decryptPw(masterPassword, encrypted);

    expect(decrypted).toBe(storedPassword);
  });

  test("different master passwords produce different ciphertexts", () => {
    const pw = "site_password_123";
    const enc1 = encryptPw("master1", pw);
    const enc2 = encryptPw("master2", pw);

    expect(enc1).not.toBe(enc2);
  });

  test("wrong master password fails to decrypt", () => {
    const encrypted = encryptPw("correct_master", "my_secret");
    const decrypted = decryptPw("wrong_master", encrypted);

    expect(decrypted).not.toBe("my_secret");
  });

  test("works with special characters", () => {
    const masterPw = "p@$$w0rd!#%^&*()";
    const sitePw = "über-sëcret<>{}[]|\\";

    const encrypted = encryptPw(masterPw, sitePw);
    const decrypted = decryptPw(masterPw, encrypted);

    expect(decrypted).toBe(sitePw);
  });

  test("works with empty password string", () => {
    const encrypted = encryptPw("master", "");
    const decrypted = decryptPw("master", encrypted);

    expect(decrypted).toBe("");
  });
});

describe("master password change: re-encryption round-trip", () => {
  // This is the exact scenario that was broken before the fix.
  // Passwords encrypted under oldMaster must be decryptable after
  // re-encrypting under newMaster.
  test("passwords survive a master password change", () => {
    const oldMaster = "old_plaintext_password";
    const newMaster = "new_plaintext_password";
    const sitePasswords = ["pw_for_gmail", "pw_for_github", "pw_for_bank"];

    // Step 1: Encrypt all passwords under the old master
    const encrypted = sitePasswords.map((pw) => encryptPw(oldMaster, pw));

    // Step 2: Re-encrypt under new master (decrypt with old, encrypt with new)
    // This is what changePassword() does internally
    const reEncrypted = encrypted.map((enc) =>
      encryptPw(newMaster, decryptPw(oldMaster, enc))
    );

    // Step 3: Verify we can decrypt with the new master
    const recovered = reEncrypted.map((enc) => decryptPw(newMaster, enc));

    expect(recovered).toEqual(sitePasswords);
  });

  test("re-encryption with hashed key instead of plaintext fails", () => {
    const plaintextPw = "my_real_password";
    const hashedPw = encryptMaster(plaintextPw); // sha3(...).substring(0,16)

    const original = "site_secret_123";

    // Encrypt with plaintext key (what the app does on store)
    const encrypted = encryptPw(plaintextPw, original);

    // Try to decrypt with the HASHED key (what the bug was doing)
    const badDecrypt = decryptPw(hashedPw, encrypted);

    // This should NOT recover the original — proving the bug
    expect(badDecrypt).not.toBe(original);

    // Correct: decrypt with plaintext key
    const goodDecrypt = decryptPw(plaintextPw, encrypted);
    expect(goodDecrypt).toBe(original);
  });

  test("full change-password flow uses correct keys", () => {
    const oldPlaintext = "old_password_123";
    const newPlaintext = "new_password_456";

    // These are what the server sees (for auth only)
    const oldEnPw = encryptMaster(oldPlaintext);
    const newEnPw = encryptMaster(newPlaintext);

    const sitePassword = "gmail_secret_pw";

    // Store: encrypted with plaintext old master
    const stored = encryptPw(oldPlaintext, sitePassword);

    // Change password: decrypt with OLD plaintext, re-encrypt with NEW plaintext
    const reEncrypted = encryptPw(newPlaintext, decryptPw(oldPlaintext, stored));

    // Retrieve after change: decrypt with NEW plaintext
    const retrieved = decryptPw(newPlaintext, reEncrypted);
    expect(retrieved).toBe(sitePassword);

    // Verify the hashed keys are different from plaintext (sanity check)
    expect(oldEnPw).not.toBe(oldPlaintext);
    expect(newEnPw).not.toBe(newPlaintext);
  });
});

describe("checkPassword", () => {
  test(`rejects passwords shorter than ${PW_MIN_LEN} characters`, () => {
    const setErrorMsg = jest.fn();
    const result = checkPassword("short", "", setErrorMsg);

    expect(result).toBe(false);
    expect(setErrorMsg).toHaveBeenCalledWith(
      expect.stringContaining("at least")
    );
  });

  test(`accepts passwords of ${PW_MIN_LEN}+ characters`, () => {
    const setErrorMsg = jest.fn();
    const result = checkPassword("a".repeat(PW_MIN_LEN), "", setErrorMsg);

    expect(result).toBe(true);
  });

  test("clears error if password meets length and previous error was about length", () => {
    const setErrorMsg = jest.fn();
    checkPassword("a".repeat(PW_MIN_LEN), `Password must be at least ${PW_MIN_LEN} characters.`, setErrorMsg);

    expect(setErrorMsg).toHaveBeenCalledWith("");
  });
});
