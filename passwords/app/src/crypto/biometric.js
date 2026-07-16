// Biometric ("Touch ID / Face ID") unlock via WebAuthn PRF.
//
// The passkey is never registered with the backend — it exists purely as a
// device-bound key-wrapping oracle. Enrollment creates a platform passkey
// with the PRF extension, derives an AES-GCM key from the PRF output, and
// stores the signed-in account info (username, en_user, aesKey, en_pw)
// encrypted in localStorage. Unlock re-evaluates the PRF (which is what
// triggers the Touch ID / Face ID prompt) and decrypts.
//
// Without a successful biometric assertion the PRF output — and therefore
// the wrapping key — is unobtainable, so the localStorage blob alone is
// useless to an attacker. The master password itself is never stored.
//
// Single-slot: enrolling overwrites any previous enrollment (one account
// per browser profile).

const STORAGE_KEY = "mapopass.biometric.v1";
const PROMO_KEY = "mapopass.biometric.promo-dismissed";
const HKDF_INFO = "mapopass biometric unlock v1";

function toB64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** User-facing name for the platform's biometric, best-effort from the UA. */
export function biometricLabel() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return "Face ID";
  if (/Macintosh/.test(ua)) return "Touch ID";
  return "biometrics";
}

export function isBiometricEnrolled() {
  return localStorage.getItem(STORAGE_KEY) !== null;
}

export function clearBiometricEnrollment() {
  localStorage.removeItem(STORAGE_KEY);
}

/** Whether the user said "Not now" to the post-login enable-unlock offer. */
export function isBiometricPromoDismissed() {
  return localStorage.getItem(PROMO_KEY) !== null;
}

export function dismissBiometricPromo() {
  localStorage.setItem(PROMO_KEY, "1");
}

/** True when the browser has a user-verifying platform authenticator. */
export async function isBiometricAvailable() {
  if (!window.PublicKeyCredential) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

async function deriveAesKey(prfOutput, hkdfSalt) {
  const material = await crypto.subtle.importKey(
    "raw",
    prfOutput,
    "HKDF",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: hkdfSalt,
      info: new TextEncoder().encode(HKDF_INFO),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Evaluate the passkey's PRF at prfSalt — this is the biometric prompt. */
async function evalPrf(credentialId, prfSalt) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: "public-key", id: credentialId }],
      userVerification: "required",
      extensions: { prf: { eval: { first: prfSalt } } },
    },
  });
  const prfOutput = assertion.getClientExtensionResults().prf?.results?.first;
  if (!prfOutput) {
    throw new Error("Authenticator did not return a PRF result.");
  }
  return prfOutput;
}

/**
 * Create a passkey and store the account info encrypted under its PRF.
 * Prompts for biometrics (twice on browsers that can't evaluate the PRF
 * at creation time). Throws on unsupported authenticators or user cancel.
 */
export async function enrollBiometric({ username, en_user, aesKey, en_pw }) {
  const prfSalt = crypto.getRandomValues(new Uint8Array(32));
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "MapoPass" },
      // Generic identity: the real username is client-side-hashed before it
      // ever leaves the app, so it must not leak into the passkey metadata
      // that syncs to iCloud Keychain.
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: "MapoPass unlock",
        displayName: "MapoPass unlock",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 }, // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "required",
      },
      extensions: { prf: { eval: { first: prfSalt } } },
    },
  });

  const ext = credential.getClientExtensionResults();
  let prfOutput = ext.prf?.results?.first;
  if (!prfOutput) {
    if (!ext.prf?.enabled) {
      clearBiometricEnrollment();
      throw new Error("This device's passkeys do not support PRF.");
    }
    // Authenticator supports PRF but couldn't evaluate during create();
    // evaluate with a follow-up assertion (second biometric prompt).
    prfOutput = await evalPrf(credential.rawId, prfSalt);
  }

  const hkdfSalt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(prfOutput, hkdfSalt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(
      JSON.stringify({ username, en_user, aesKey, en_pw })
    )
  );

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      credentialId: toB64url(credential.rawId),
      prfSalt: toB64url(prfSalt),
      hkdfSalt: toB64url(hkdfSalt),
      iv: toB64url(iv),
      ciphertext: toB64url(ciphertext),
    })
  );
}

/**
 * Prompt for biometrics and return the decrypted account info
 * ({ username, en_user, aesKey, en_pw }). Throws if not enrolled, on user
 * cancel (NotAllowedError), or if the stored blob can't be decrypted.
 */
export async function unlockBiometric() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) {
    throw new Error("Biometric unlock is not set up.");
  }
  const enrollment = JSON.parse(raw);
  const prfOutput = await evalPrf(
    fromB64url(enrollment.credentialId),
    fromB64url(enrollment.prfSalt)
  );
  const key = await deriveAesKey(prfOutput, fromB64url(enrollment.hkdfSalt));
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64url(enrollment.iv) },
    key,
    fromB64url(enrollment.ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}
