import { useState } from "react";
import { errorColor, backgroundColor } from "../theme";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import { encryptMaster, shaHash, checkPassword } from "../crypto/encrypt";
import { showLoader, hideLoader } from "../loader/loader";
import { KeyBinds } from "../util";
import "./account.css";

const ERROR_MSG_TIME_IN_MS = 10000;
const TOGGLE_CREATE_ACCOUNT_DELAY_IN_MS = 300;

export default function SignIn({ user, backend, setAccountInfo }) {
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
    if (
      isCreatingAccount &&
      !checkPassword(password, errorMsg, setErrorMsgHook)
    ) {
      return;
    }
    const submittedPw = encryptMaster(password);
    const submittedUser = encryptMaster(username);
    const aesKey = shaHash(password);
    setPasswordHook("");
    showLoader();
    fetch(
      isCreatingAccount
        ? `${backend}/api/v2/user`
        : `${backend}/api/v2/user/verify`,
      {
        method: isCreatingAccount ? "POST" : "GET",
        headers: {
          "x-username": submittedUser,
          "x-password": submittedPw,
        },
      }
    )
      .then((response) => {
        if (response.status !== 200) {
          throw new Error("Unable to log in.");
        }
        setAccountInfo(username, submittedUser, aesKey, submittedPw);
      })
      .catch(() => {
        setErrorMsg(
          isCreatingAccount
            ? " Unable to create account, please try a different usename."
            : "Unable to log in, please try again."
        );
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
        <div className="Input-Header-text">
          {isCreatingAccount ? (
            <div>Please set up a new account:</div>
          ) : (
            <div>To begin, please sign in to your account:</div>
          )}
        </div>
        <TextField
          type="text"
          label="username"
          onChange={(e) => {
            setUsername(e.target.value);
          }}
          value={username}
          autoFocus={true}
          onKeyPress={(e) => {
            onKeyPress(e, isCreatingAccount);
          }}
          sx={{
            fieldset: { borderColor: "black" },
            input: { color: "black" },
            label: { color: "black" },
            "& .MuiOutlinedInput-root": {
              "&.Mui-focused fieldset": {
                borderColor: "#3f50b5",
              },
            },
            "&:hover fieldset": {
              borderColor: "#3f50b5 !important",
            },
          }}
          InputLabelProps={{
            sx: { "&.Mui-focused": { color: "#3f50b5" } },
          }}
        />
        <TextField
          type="password"
          label="password"
          onChange={(e) => {
            setPassword(e.target.value);
          }}
          value={password}
          onKeyPress={(e) => {
            onKeyPress(e, isCreatingAccount);
          }}
          sx={{
            marginTop: "12px",
            fieldset: { borderColor: "black" },
            input: { color: "black" },
            label: { color: "black" },
            "& .MuiOutlinedInput-root": {
              "&.Mui-focused fieldset": {
                borderColor: "#3f50b5",
              },
            },
            "&:hover fieldset": {
              borderColor: "#3f50b5 !important",
            },
          }}
          InputLabelProps={{
            sx: { "&.Mui-focused": { color: "#3f50b5" } },
          }}
        />
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
          {errorMsg.length === 0 ? "" : errorMsg}
        </div>
      </div>
      <Button
        variant="contained"
        type="button"
        sx={{
          width: "100%",
          height: "45px",
          borderRadius: "8px",
          backgroundColor: "#282c34",
          ":hover": {
            backgroundColor: "#3f50b5",
          },
          fontWeight: "bold",
          color: "white",
        }}
        onClick={submit}
      >
        {isCreatingAccount ? "Sign up" : "Log In"}
      </Button>
      {isCreatingAccount ? (
        <p style={{ fontSize: "18px" }}>
          Have an account already? Log in{" "}
          <span
            style={{ color: "#3f50b5" }}
            onClick={() => {
              toggleCreatingAccount(false);
            }}
          >
            here
          </span>
          .
        </p>
      ) : (
        <p style={{ fontSize: "18px" }}>
          First time? Sign up{" "}
          <span
            style={{ color: "#3f50b5" }}
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
