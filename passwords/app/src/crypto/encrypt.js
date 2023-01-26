const PW_MIN_LEN = 0;

export function encryptMaster(password) {
    return `${password}`;
}

export async function changePassword(backend, user, pw, newPw) {
    await fetch(
        `${backend}/api/v1/get/getpws/${user}/${pw}`, 
        { 
          method: 'GET',
        }
      )
        .then((response) => {
          if (response.status !== 200 ){
            console.log(response);
            throw new Error("Unable to log in.");
          }
          return response.json();
        })
        .then((json) => {
            console.log(json);
        })
        .catch((e) => {
          console.error(e);
          return false;
        });
    return true;
}

export function checkPassword(pw, currErr, setErrorMsg) {
    let ret = pw.length >= PW_MIN_LEN;
    if (!ret) {
      setErrorMsg(`Password must be at least ${PW_MIN_LEN} characters.`);
    }
    else if (currErr.startsWith("Password must be at least")) {
      setErrorMsg("");
    }
    return ret;
  }