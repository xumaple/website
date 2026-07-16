/**
 * Unit tests for the WebAuthn-PRF biometric unlock module.
 *
 * jsdom ships neither WebAuthn nor WebCrypto, so both are simulated:
 * `crypto` comes from Node's webcrypto, and `navigator.credentials` is a
 * fake platform authenticator whose PRF is HMAC-SHA256(deviceSecret, salt) —
 * deterministic per credential, unknowable without the device secret, which
 * is exactly the contract the real extension provides.
 */
import { webcrypto } from "crypto";
import { TextEncoder, TextDecoder } from "util";
import {
  isBiometricEnrolled,
  clearBiometricEnrollment,
  enrollBiometric,
  unlockBiometric,
} from "./biometric";

const ACCOUNT = {
  username: "maple",
  en_user: "abc123hasheduser",
  aesKey: "deadbeef".repeat(8),
  en_pw: "0123456789abcdef",
};

beforeAll(() => {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
});

beforeEach(() => {
  localStorage.clear();
});

async function prf(deviceSecret, salt) {
  const key = await webcrypto.subtle.importKey(
    "raw",
    deviceSecret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return webcrypto.subtle.sign("HMAC", key, salt);
}

/**
 * Install a fake platform authenticator on navigator.credentials.
 * `prfAtCreate: false` simulates browsers (e.g. older Chrome) that report
 * prf.enabled at create() but only evaluate on a follow-up get().
 */
function installFakeAuthenticator({ prfAtCreate = true } = {}) {
  const deviceSecret = webcrypto.getRandomValues(new Uint8Array(32));
  const credId = webcrypto.getRandomValues(new Uint8Array(16));
  const fake = {
    async create(options) {
      const salt = options.publicKey.extensions.prf.eval.first;
      const results = prfAtCreate
        ? { first: await prf(deviceSecret, salt) }
        : undefined;
      return {
        rawId: credId.buffer.slice(0),
        getClientExtensionResults: () => ({
          prf: { enabled: true, ...(results ? { results } : {}) },
        }),
      };
    },
    async get(options) {
      const allowed = new Uint8Array(options.publicKey.allowCredentials[0].id);
      if (Buffer.compare(Buffer.from(allowed), Buffer.from(credId)) !== 0) {
        const err = new Error("credential not found");
        err.name = "NotAllowedError";
        throw err;
      }
      const salt = options.publicKey.extensions.prf.eval.first;
      const first = await prf(deviceSecret, salt);
      return { getClientExtensionResults: () => ({ prf: { results: { first } } }) };
    },
  };
  Object.defineProperty(window.navigator, "credentials", {
    value: fake,
    configurable: true,
  });
}

test("enroll then unlock round-trips the account info", async () => {
  installFakeAuthenticator();
  expect(isBiometricEnrolled()).toBe(false);
  await enrollBiometric(ACCOUNT);
  expect(isBiometricEnrolled()).toBe(true);
  expect(await unlockBiometric()).toEqual(ACCOUNT);
});

test("enroll works when PRF is only available on a follow-up get()", async () => {
  installFakeAuthenticator({ prfAtCreate: false });
  await enrollBiometric(ACCOUNT);
  expect(await unlockBiometric()).toEqual(ACCOUNT);
});

test("stored blob does not contain any secret in plaintext", async () => {
  installFakeAuthenticator();
  await enrollBiometric(ACCOUNT);
  const blob = localStorage.getItem("mapopass.biometric.v1");
  expect(blob).not.toBeNull();
  for (const secret of Object.values(ACCOUNT)) {
    expect(blob).not.toContain(secret);
  }
});

test("unlock fails if the stored ciphertext is tampered with", async () => {
  installFakeAuthenticator();
  await enrollBiometric(ACCOUNT);
  const blob = JSON.parse(localStorage.getItem("mapopass.biometric.v1"));
  blob.ciphertext =
    (blob.ciphertext[0] === "A" ? "B" : "A") + blob.ciphertext.slice(1);
  localStorage.setItem("mapopass.biometric.v1", JSON.stringify(blob));
  await expect(unlockBiometric()).rejects.toThrow();
});

test("clearing the enrollment makes unlock impossible", async () => {
  installFakeAuthenticator();
  await enrollBiometric(ACCOUNT);
  clearBiometricEnrollment();
  expect(isBiometricEnrolled()).toBe(false);
  await expect(unlockBiometric()).rejects.toThrow(
    "Biometric unlock is not set up."
  );
});

test("a different authenticator cannot unlock (fresh device secret)", async () => {
  installFakeAuthenticator();
  await enrollBiometric(ACCOUNT);
  // Same credential id would be a NotAllowedError; simulate the worst case —
  // an authenticator that answers for the credential but with a different
  // device secret. Decryption must fail.
  const blob = JSON.parse(localStorage.getItem("mapopass.biometric.v1"));
  const otherSecret = webcrypto.getRandomValues(new Uint8Array(32));
  Object.defineProperty(window.navigator, "credentials", {
    configurable: true,
    value: {
      async get(options) {
        const salt = options.publicKey.extensions.prf.eval.first;
        const first = await prf(otherSecret, salt);
        return {
          getClientExtensionResults: () => ({ prf: { results: { first } } }),
        };
      },
    },
  });
  expect(localStorage.getItem("mapopass.biometric.v1")).toBe(
    JSON.stringify(blob)
  );
  await expect(unlockBiometric()).rejects.toThrow();
});
