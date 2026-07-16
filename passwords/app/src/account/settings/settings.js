import { useState, useEffect } from "react";
import Modal from "react-modal";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Divider from "@mui/material/Divider";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import { showLoader, hideLoader } from "../../loader/loader";
import {
  encryptMaster,
  shaHash,
  changePasswordWithKey,
  checkPassword,
} from "../../crypto/encrypt";
import {
  biometricLabel,
  isBiometricAvailable,
  isBiometricEnrolled,
  enrollBiometric,
  clearBiometricEnrollment,
} from "../../crypto/biometric";
import "./settings.css";

const customStyles = {
  content: {
    top: "50%",
    left: "50%",
    right: "auto",
    bottom: "auto",
    alignItems: "left",
    marginRight: "-50%",
    transform: "translate(-50%, -50%)",
    backgroundColor: "#282c34",
    opacity: 1,
    borderRadius: "12px",
    maxWidth: "400px",
    width: "100%",
  },
  overlay: {
    backgroundColor: "rgba(255, 255, 255, 0.4)",
    zIndex: 100,
  },
};

export default function SettingsModal({
  username,
  en_user,
  aesKey,
  en_pw,
  backend,
  setAesKey,
  setEnPassword,
  show,
  stopShowing,
}) {
  const [currAesKey, setCurrAesKey] = useState(aesKey);
  const [pw, setPw] = useState(en_pw);
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [msg, setMsg] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnrolled, setBioEnrolled] = useState(isBiometricEnrolled());

  useEffect(() => {
    Modal.setAppElement("#account-root");
  });

  useEffect(() => {
    isBiometricAvailable().then(setBioAvailable);
  }, []);

  const enableBiometric = async () => {
    try {
      await enrollBiometric({
        username,
        en_user,
        aesKey: currAesKey,
        en_pw: pw,
      });
      setBioEnrolled(true);
      setErrorMsg("");
    } catch (e) {
      if (e && e.name === "NotAllowedError") {
        return; // user dismissed the biometric prompt
      }
      setMsg("");
      setErrorMsg(`Unable to turn on ${biometricLabel()}.`);
    }
  };

  const disableBiometric = () => {
    clearBiometricEnrollment();
    setBioEnrolled(false);
  };

  const trySave = async () => {
    if (newPw !== newPw2) {
      setMsg("");
      setErrorMsg("Passwords must match");
      return;
    }
    if (!checkPassword(newPw, errorMsg, setErrorMsg)) {
      return;
    }
    const newPwTry = encryptMaster(newPw);
    if (newPwTry === pw) {
      setMsg("");
      setErrorMsg("Must be a new password");
      return;
    }
    const newAesKey = shaHash(newPw);
    setNewPw("");
    setNewPw2("");
    setErrorMsg("");
    setIsSaving(true);
    setMsg("Updating password...");
    showLoader();
    let res = await changePasswordWithKey(backend, en_user, currAesKey, pw, newAesKey, newPwTry);
    if (res) {
      // success
      setCurrAesKey(newAesKey);
      setPw(newPwTry);
      setAesKey(newAesKey);
      setEnPassword(newPwTry);
      // The biometric enrollment caches the old credentials — clear it
      // rather than serve a stale unlock.
      if (isBiometricEnrolled()) {
        clearBiometricEnrollment();
        setBioEnrolled(false);
        setMsg(
          <div className="green">
            Password updated successfully. {biometricLabel()} was turned off
            — re-enable it above.
          </div>
        );
      } else {
        setMsg(<div className="green">Password updated successfully.</div>);
      }
    } else {
      setMsg("");
      setErrorMsg("Unable to update password.");
    }
    hideLoader();
  };

  const closeModal = () => {
    isSaving &&
      setTimeout(() => {
        setNewPw("");
        setNewPw2("");
        setMsg("");
        setErrorMsg("");
      }, 200);
    stopShowing();
  };

  return (
    <div key="Settings">
      <Modal
        isOpen={show}
        onRequestClose={closeModal}
        style={customStyles}
        contentLabel="Settings"
        closeTimeoutMS={200}
      >
        <div className="Settings-modal">
          <Tooltip title="Close">
            <IconButton
              aria-label="Close settings"
              onClick={closeModal}
              sx={{
                position: "absolute",
                top: "10px",
                right: "10px",
                color: "rgba(200, 200, 200, 0.96)",
                ":hover": { color: "white" },
              }}
            >
              <CloseIcon />
            </IconButton>
          </Tooltip>
          <h2 style={{ alignSelf: "center" }}>Edit Account Info</h2>
          <div className="row">
            <div>
              <TextField
                type="text"
                label="Username"
                value={username}
                autoFocus={true}
                disabled="disabled"
                sx={{
                  width: "100%",
                  fieldset: { borderColor: "rgba(200, 200, 200, 0.96);" },
                  input: { color: "rgba(200, 200, 200, 0.96);" },
                  label: { color: "rgba(200, 200, 200, 0.96);" },
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
            </div>
          </div>
          {bioAvailable && (
            <div className="row">
              <div style={{ width: "100%", gap: "8px", alignItems: "center" }}>
                <Button
                  variant="outlined"
                  type="button"
                  disabled={bioEnrolled}
                  startIcon={bioEnrolled ? <CheckIcon /> : undefined}
                  sx={{
                    flexGrow: 1,
                    height: "45px",
                    borderRadius: "8px",
                    fontWeight: "bold",
                    color: "white",
                    borderColor: "rgba(200, 200, 200, 0.96)",
                    ":hover": {
                      backgroundColor: "#3f50b5",
                      borderColor: "rgba(200, 200, 200, 0.96)",
                    },
                    "&.Mui-disabled": {
                      color: "rgb(82, 165, 82)",
                      borderColor: "rgba(200, 200, 200, 0.4)",
                    },
                  }}
                  onClick={enableBiometric}
                >
                  {bioEnrolled
                    ? `${biometricLabel()} enabled`
                    : `Use ${biometricLabel()}`}
                </Button>
                {bioEnrolled && (
                  <Tooltip title={`Turn off ${biometricLabel()}`}>
                    <IconButton
                      aria-label={`Turn off ${biometricLabel()}`}
                      onClick={disableBiometric}
                      sx={{
                        color: "rgba(200, 200, 200, 0.96)",
                        ":hover": { color: "white" },
                      }}
                    >
                      <CloseIcon />
                    </IconButton>
                  </Tooltip>
                )}
              </div>
            </div>
          )}
          <Divider
            sx={{
              borderColor: "rgba(200, 200, 200, 0.25)",
              margin: "16px 10px 6px",
            }}
          />
          <div className="row">
            <div>
              <TextField
                type="password"
                label="New Password"
                onChange={(e) => {
                  setNewPw(e.target.value);
                }}
                value={newPw}
                autoFocus={true}
                sx={{
                  width: "100%",
                  fieldset: { borderColor: "rgba(200, 200, 200, 0.96);" },
                  input: { color: "rgba(200, 200, 200, 0.96);" },
                  label: { color: "rgba(200, 200, 200, 0.96);" },
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
            </div>
          </div>
          <div className="row">
            <div>
              <TextField
                type="password"
                label="Confirm New Password"
                onChange={(e) => {
                  setNewPw2(e.target.value);
                }}
                value={newPw2}
                autoFocus={true}
                sx={{
                  width: "100%",
                  fieldset: { borderColor: "rgba(200, 200, 200, 0.96)" },
                  input: { color: "rgba(200, 200, 200, 0.96);" },
                  label: { color: "rgba(200, 200, 200, 0.96);" },
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
            </div>
          </div>
          <div className="msg">
            <div>{msg}</div>
            <div className="error">{errorMsg}</div>
          </div>
          <div className="row">
            <Button
              variant="outlined"
              type="button"
              sx={{
                width: "100%",
                height: "45px",
                borderRadius: "8px",
                ":hover": {
                  borderColor: "white",
                },
                backgroundColor: "#3f50b5",
                borderColor: "rgba(200, 200, 200, 0.96)",
                fontWeight: "bold",
                color: "white",
              }}
              onClick={trySave}
            >
              Change Password
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
