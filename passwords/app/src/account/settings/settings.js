import { useState, useEffect } from "react";
import Modal from "react-modal";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import { showLoader, hideLoader } from "../../loader/loader";
import {
  encryptMaster,
  changePassword,
  checkPassword,
} from "../../crypto/encrypt";
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
  password,
  en_pw,
  backend,
  setPassword,
  setEnPassword,
  show,
  stopShowing,
}) {
  const [plaintextPw, setPlaintextPw] = useState(password);
  const [pw, setPw] = useState(en_pw);
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [msg, setMsg] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    Modal.setAppElement("#account-root");
  });

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
    setNewPw("");
    setNewPw2("");
    setErrorMsg("");
    setIsSaving(true);
    setMsg("Updating password...");
    showLoader();
    let res = await changePassword(backend, en_user, plaintextPw, pw, newPw, newPwTry);
    if (res) {
      // success
      setPlaintextPw(newPw);
      setPw(newPwTry);
      setPassword(newPw);
      setEnPassword(newPwTry);
      setMsg(<div className="green">Password updated successfully.</div>);
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
          <div className="buttons">
            <Button
              variant="outlined"
              type="button"
              sx={{
                width: "50%",
                height: "45px",
                borderRadius: "8px",
                ":hover": {
                  backgroundColor: "#3f50b5",
                  borderColor: "rgba(200, 200, 200, 0.96)",
                },
                borderColor: "rgba(200, 200, 200, 0.96)",
                fontWeight: "bold",
                color: "white",
              }}
              onClick={closeModal}
            >
              Back
            </Button>
            <Button
              variant="outlined"
              type="button"
              sx={{
                width: "50%",
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
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
