import sha3 from "crypto-js/sha3";
import sha256 from "crypto-js/sha256";
import aes from "crypto-js/aes";
import Utf8 from "crypto-js/enc-utf8";

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

export async function changePassword(backend, en_user, oldPlaintextPw, oldEnPw, newPlaintextPw, newEnPw) {
  let result = await fetch(`${backend}/api/v2/passwords`, {
    method: "GET",
    headers: {
      "x-username": en_user,
      "x-password": oldEnPw,
    },
  })
    .then((response) => {
      if (response.status !== 200) {
        console.log(response);
        throw new Error("Error while trying to get passwords.");
      }
      return response.json();
    })
    .then((json) => {
      const updated_pws = json.map((p) => encryptPw(newPlaintextPw, decryptPw(oldPlaintextPw, p)));
      console.log("got to", updated_pws);
      return fetch(`${backend}/api/v2/user`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-username": en_user,
          "x-password": oldEnPw,
        },
        body: JSON.stringify({
          new_password: newEnPw,
          passwords: updated_pws,
        }),
      })
        .then((response) => {
          console.log("Still fetching");
          if (response.status !== 200) {
            console.log(response);
            throw new Error("Error while trying to update passwords");
          }
          return true;
        })
        .catch((e) => {
          console.error("Error sending updated passwords to server");
          throw e;
        });
    })
    .catch((e) => {
      console.error(e);
      return false;
    });
  console.log("result: ", result);

  return result !== false;
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
