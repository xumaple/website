import { useState } from "react";
import { errorColor, backgroundColor, highlightColor } from "../theme";
import TextField from "@mui/material/TextField";
import { encryptMaster, checkPassword } from "../crypto/encrypt";
import { showLoader, hideLoader } from "../loader/loader";
import { useTheme } from "@mui/material/styles";
import { KeyBinds } from "../util";
import "./account.css";

const ERROR_MSG_TIME_IN_MS = 10000;
const TOGGLE_CREATE_ACCOUNT_DELAY_IN_MS = 300;

export default function SignIn({ user, backend, setAccountInfo }) {
  const theme = useTheme();
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [errorMsg, setErrorMsgHook] = useState("");
  const setErrorMsg = (msg) => {
    setTimeout(() => {
      setErrorMsgHook("");
    }, ERROR_MSG_TIME_IN_MS);
    setErrorMsgHook(msg);
  };
  const [username, setUsername] = useState(user);
  const [password, setPasswordHook] = useState("");

  let submit = () => {
    if (username === "" || password === "") {
      setErrorMsg("Please enter a valid username and password.");
      return;
    }
    const submittedPw = encryptMaster(password);
    setPasswordHook("");
    console.log("submitted password with user", username);
    showLoader();
    fetch(
      isCreatingAccount
        ? `${backend}/api/v1/post/newuser?username=${username}&password=${submittedPw}`
        : `${backend}/api/v1/get/verifyuser?username=${username}&password=${submittedPw}`,
      {
        method: isCreatingAccount ? "POST" : "GET",
        headers: { "Content-Type": "text/plain" },
      }
    )
      .then((response) => {
        if (response.status !== 200) {
          console.log(response);
          throw new Error("Unable to log in.");
        }
        setAccountInfo(username, submittedPw);
      })
      .catch((e) => {
        setErrorMsg(
          isCreatingAccount
            ? " Unable to create account, please try a different usename."
            : "Unable to log in, please try again."
        );
        console.error(e);
      })
      .finally(hideLoader);
  };

  const toggleCreatingAccount = (b) => {
    showLoader();
    setTimeout(() => {
      hideLoader();
      setIsCreatingAccount(b);
    }, TOGGLE_CREATE_ACCOUNT_DELAY_IN_MS);
    setErrorMsgHook("");
  };

  const onKeyPress = (e, verifyPassword = false) => {
    if (e.charCode === KeyBinds.ENTER) {
      if (
        verifyPassword &&
        !checkPassword(password, errorMsg, setErrorMsgHook)
      ) {
        return;
      }
      submit();
    }
  };

  const setPassword = (password) => {
    if (isCreatingAccount) {
      checkPassword(password, errorMsg, setErrorMsgHook);
    }
    setPasswordHook(password);
  };

  return (
    <div className="SignIn">
      <div className="SignIn-info">
        {isCreatingAccount ? (
          <div>Please set up a new account:</div>
        ) : (
          <div>To begin, please sign in to your account:</div>
        )}
        <div
          className={
            errorMsg.length === 0 ? "SignIn-error-invis" : "SignIn-error"
          }
          style={
            errorMsg.length === 0
              ? { color: backgroundColor }
              : { color: errorColor }
          }
        >
          {errorMsg.length === 0 ? "NoError" : errorMsg}
        </div>
        <TextField
          type="text"
          label="username"
          onChange={(e) => {
            setUsername(e.target.value);
          }}
          value={username}
          autoFocus={true}
          onKeyPress={
            isCreatingAccount
              ? (e) => {
                  onKeyPress(e, true);
                }
              : onKeyPress
          }
        />
        <TextField
          type="password"
          label="password"
          onChange={(e) => {
            setPassword(e.target.value);
          }}
          value={password}
          onKeyPress={
            isCreatingAccount
              ? (e) => {
                  onKeyPress(e, true);
                }
              : onKeyPress
          }
        />
      </div>
      <button type="button" onClick={submit}>
        {isCreatingAccount ? "Sign up" : "Log In"}
      </button>
      {isCreatingAccount ? (
        <p>
          Have an account already? Log in{" "}
          <span
            className="SignIn-link"
            style={{ color: highlightColor }}
            onClick={() => {
              toggleCreatingAccount(false);
            }}
          >
            here
          </span>
          .
        </p>
      ) : (
        <p>
          First time? Sign up{" "}
          <span
            className="SignIn-link"
            style={{ color: highlightColor }}
            onClick={() => {
              toggleCreatingAccount(true);
            }}
          >
            here
          </span>
          .
        </p>
      )}
    </div>
  );
}
