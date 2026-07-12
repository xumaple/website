import sha3 from "crypto-js/sha3";
import sha256 from "crypto-js/sha256";
import aes from "crypto-js/aes";
import Utf8 from "crypto-js/enc-utf8";
import { apiGetAllBuckets, apiChangeMasterPassword } from "../api";

export const PW_MIN_LEN = 13;

export function encryptMaster(password) {
  return sha3(password).toString().substring(0, 16);
}

export function encryptPw(mp, password) {
  return encryptAES(password, shaHash(mp));
}

export function decryptPw(mp, en_password) {
  return decryptAES(en_password, shaHash(mp));
}

export function encryptPwWithKey(aesKey, password) {
  return encryptAES(password, aesKey);
}

export function decryptPwWithKey(aesKey, en_password) {
  return decryptAES(en_password, aesKey);
}

export function shaHash(text) {
  return sha256(text).toString();
}

function encryptAES(text, key) {
  return aes.encrypt(text, key).toString();
}

function decryptAES(en_text, key) {
  const bytes = aes.decrypt(en_text, key);
  return bytes.toString(Utf8);
}

export async function changePasswordWithKey(backend, en_user, oldAesKey, oldEnPw, newAesKey, newEnPw) {
  const auth = { en_user, en_pw: oldEnPw };
  try {
    const buckets = await apiGetAllBuckets(backend, auth);
    // Re-encrypt every field of every bucket under the new AES key,
    // preserving bucket keys, field labels, sensitivity, and order.
    const updated_buckets = buckets.map((bucket) => ({
      key: bucket.key,
      fields: bucket.fields.map((field) => ({
        label: field.label,
        en_value: encryptPwWithKey(
          newAesKey,
          decryptPwWithKey(oldAesKey, field.en_value)
        ),
        sensitive: field.sensitive,
      })),
    }));
    await apiChangeMasterPassword(backend, auth, newEnPw, updated_buckets);
    return true;
  } catch (e) {
    return false;
  }
}

export function checkPassword(pw, currErr, setErrorMsg) {
  let ret = pw.length >= PW_MIN_LEN;
  if (!ret) {
    setErrorMsg(`Password must be at least ${PW_MIN_LEN} characters.`);
  } else if (currErr.startsWith("Password must be at least")) {
    setErrorMsg("");
  }
  return ret;
}
