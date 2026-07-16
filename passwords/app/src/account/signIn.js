import { useState, useEffect } from "react";
import { errorColor, backgroundColor } from "../theme";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import FingerprintIcon from "@mui/icons-material/Fingerprint";
import { encryptMaster, shaHash, checkPassword } from "../crypto/encrypt";
import {
  biometricLabel,
  isBiometricEnrolled,
  unlockBiometric,
  clearBiometricEnrollment,
} from "../crypto/biometric";
import { apiCreateUser, apiVerifyUser } from "../api";
import { showLoader, hideLoader } from "../loader/loader";
import { KeyBinds } from "../util";
import { ACCENT, textFieldSx, inputLabelProps, primaryButtonSx } from "./styles";
import "./account.css";

const ERROR_MSG_TIME_IN_MS = 10000;
const TOGGLE_CREATE_ACCOUNT_DELAY_IN_MS = 300;

// Biometric unlock auto-fires at most once per page load: returning to the
// sign-in screen (log out, cancelled prompt) must never re-prompt — cancel
// means "I want to type my password". Module-level so it survives remounts.
let autoUnlockAttempted = false;

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
  const [biometricEnrolled, setBiometricEnrolled] = useState(
    isBiometricEnrolled()
  );

  const biometricUnlock = async () => {
    showLoader();
    let info;
    try {
      info = await unlockBiometric();
    } catch (e) {
      hideLoader();
      if (e && e.name === "NotAllowedError") {
        // User dismissed the biometric prompt — keep the enrollment.
        return;
      }
      // Credential gone or blob undecryptable — enrollment is dead weight.
      clearBiometricEnrollment();
      setBiometricEnrolled(false);
      setErrorMsg(
        `${biometricLabel()} is no longer set up. Please sign in with your password.`
      );
      return;
    }
    try {
      await apiVerifyUser(backend, { en_user: info.en_user, en_pw: info.en_pw });
      setAccountInfo(info.username, info.en_user, info.aesKey, info.en_pw);
    } catch (e) {
      if (/status 4\d\d/.test(e.message)) {
        // Server rejected the cached credentials (e.g. the master password
        // changed elsewhere) — the enrollment is stale.
        clearBiometricEnrollment();
        setBiometricEnrolled(false);
        setErrorMsg(
          `${biometricLabel()} is out of date. Please sign in with your password.`
        );
      } else {
        setErrorMsg("Unable to log in, please try again.");
      }
    } finally {
      hideLoader();
    }
  };

  useEffect(() => {
    const shouldAttempt = !autoUnlockAttempted && biometricEnrolled;
    autoUnlockAttempted = true;
    if (shouldAttempt) {
      // Browsers may refuse a WebAuthn prompt with no user gesture; that
      // surfaces as NotAllowedError, which biometricUnlock treats as a
      // cancel — the button and password form remain the fallback.
      biometricUnlock();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const auth = { en_user: submittedUser, en_pw: submittedPw };
    (isCreatingAccount
      ? apiCreateUser(backend, auth)
      : apiVerifyUser(backend, auth)
    )
      .then(() => {
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
          sx={textFieldSx}
          InputLabelProps={inputLabelProps}
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
          sx={{ marginTop: "12px", ...textFieldSx }}
          InputLabelProps={inputLabelProps}
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
        sx={primaryButtonSx}
        onClick={submit}
      >
        {isCreatingAccount ? "Sign up" : "Log In"}
      </Button>
      {!isCreatingAccount && biometricEnrolled && (
        <Button
          variant="outlined"
          type="button"
          startIcon={<FingerprintIcon />}
          sx={{
            ...primaryButtonSx,
            marginTop: "12px",
            backgroundColor: "transparent",
            color: ACCENT,
            borderColor: ACCENT,
            ":hover": {
              borderColor: ACCENT,
              backgroundColor: "rgba(63, 80, 181, 0.08)",
            },
          }}
          onClick={biometricUnlock}
        >
          Use {biometricLabel()}
        </Button>
      )}
      {isCreatingAccount ? (
        <p style={{ fontSize: "18px" }}>
          Have an account already? Log in{" "}
          <span
            style={{ color: ACCENT }}
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
            style={{ color: ACCENT }}
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
