import sha3 from "crypto-js/sha3";
import sha256 from "crypto-js/sha256";
import aes from "crypto-js/aes";
import Utf8 from "crypto-js/enc-utf8";
// import NoPadding from "crypto-js/pad-nopadding";

const PW_MIN_LEN = 3;

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
  // return sha3(text, { outputLength: 256 }).toString();
}

function encryptAES(text, key) {
  return aes
    .encrypt(
      text,
      key
      // { mode: NoPadding }
    )
    .toString();
}

function decryptAES(en_text, key) {
  const bytes = aes.decrypt(
    en_text,
    key
    // { mode: NoPadding }
  );
  return bytes.toString(Utf8);
}

export async function changePassword(backend, en_user, pw, newPw) {
  let result = await fetch(
    `${backend}/api/v1/get/getpws?username=${en_user}&password=${pw}`,
    {
      method: "GET",
      headers: { "Content-Type": "text/plain" },
    }
  )
    .then((response) => {
      if (response.status !== 200) {
        console.log(response);
        throw new Error("Error while trying to get passwords.");
      }
      return response.json();
    })
    .then((json) => {
      const updated_pws = json.map((p) => encryptPw(newPw, decryptPw(pw, p)));
      console.log("got to", updated_pws);
      return fetch(
        // `${backend}/api/v1/get/getpws/${en_user}/${pw}`,
        `${backend}/api/v1/post/updateuser?username=${en_user}&password=${pw}&new_password=${newPw}`,
        {
          method: "POST",
          body: JSON.stringify(updated_pws),
        }
      )
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
