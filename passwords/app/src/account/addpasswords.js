import { useState, useEffect, useCallback, useReducer } from "react";
import { encryptPw } from "../crypto/encrypt";
import Modal from "react-modal";
import TextField from "@mui/material/TextField";
import GoodCircle from "@mui/icons-material/CheckCircle";
import BadCircle from "@mui/icons-material/Error";
import WaitingCircle from "@mui/icons-material/Pending";
import Cancel from "@mui/icons-material/Cancel";
import Button from "@mui/material/Button";

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
    maxWidth: "500px",
    width: "100%",
  },
  overlay: {
    backgroundColor: "rgba(255, 255, 255, 0.4)",
    zIndex: 100,
  },
};

const UPLOAD_PENDING = 0;
const UPLOAD_GOOD = 1;
const UPLOAD_BAD = 2;

let PasswordInput = ({
  removeMe,
  showRemoveMe,
  communicateUploadState,
  password,
  en_pw,
  en_user,
  backend,
  addNewKey,
}) => {
  const [key, setKey] = useState("");
  const [pw, setPw] = useState("");
  const [keyError, setKeyError] = useState("");
  const [currentlyUploading, setCurrentlyUploading] = useState(false);
  const [uploadState, setInnerUploadState] = useState(UPLOAD_PENDING);

  let setUploadState = useCallback(
    (state) => {
      setInnerUploadState(state);
      if (communicateUploadState !== null) {
        communicateUploadState(state);
      }
    },
    [communicateUploadState]
  );

  useEffect(() => {
    if (
      currentlyUploading === true ||
      communicateUploadState === null ||
      uploadState === UPLOAD_GOOD
    ) {
      return;
    }

    // UPLOAD_BAD signals that this row cannot be uploaded (missing fields or
    // validation error). The parent resets the row back to NOT_UPLOADING.
    // Specific validation errors (e.g. key too long) are surfaced via the
    // TextField's helperText, not via the upload-state icon.
    if (key === "" || pw === "" || key.length > 128) {
      setUploadState(UPLOAD_BAD);
      return;
    }

    setInnerUploadState(UPLOAD_PENDING);
    setCurrentlyUploading(true);

    fetch(
      `${backend}/api/v2/passwords/${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-username": en_user,
          "x-password": en_pw,
        },
        body: JSON.stringify({ encrypted_password: encryptPw(password, pw) }),
      }
    )
      .then((response) => {
        if (response.status !== 200) {
          setUploadState(UPLOAD_BAD);
          throw new Error("Error while trying to store new password.");
        }
        setUploadState(UPLOAD_GOOD);
        addNewKey(key);
      })
      .finally(() => {
        setCurrentlyUploading(false);
      });
  }, [
    currentlyUploading,
    communicateUploadState,
    uploadState,
    setUploadState,
    addNewKey,
    backend,
    en_pw,
    en_user,
    key,
    password,
    pw,
  ]);

  let showUploadStatus = (status) => {
    if (status === UPLOAD_PENDING) {
      return currentlyUploading && <WaitingCircle sx={{ color: "#eed202" }} />;
    }
    if (status === UPLOAD_GOOD) {
      return <GoodCircle sx={{ color: "green" }} />;
    }
    if (status === UPLOAD_BAD) {
      return <BadCircle sx={{ color: "red" }} />;
    }
    return "";
  };

  return (
    <div className="Manual-password-container">
      <TextField
        type="text"
        label="key"
        error={keyError !== ""}
        helperText={keyError}
        onChange={(e) => {
          const newKey = e.target.value;
          setKey(newKey);
          if (newKey.length > 128) {
            setKeyError("Key is too long (max 128 characters).");
          } else {
            setKeyError("");
          }
        }}
        sx={{
          width: "50%",
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
        value={key}
      />
      <TextField
        type="password"
        label="password"
        onChange={(e) => {
          setPw(e.target.value);
        }}
        sx={{
          width: "50%",
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
        value={pw}
      />
      {showRemoveMe && !currentlyUploading && (
        <Cancel
          onClick={() => {
            removeMe();
          }}
          sx={{
            "&:hover": {
              color: "red",
            },
          }}
        />
      )}
      {showUploadStatus(uploadState)}
    </div>
  );
};

const NOT_UPLOADING = false;
const IS_UPLOADING = true;

// reducer actions
const ADD = 0;
const REMOVE = 1;
const CHANGE_ONE = 2;
const SAVE_ALL = 3;

export default function AddPasswordsModal({
  password,
  en_pw,
  en_user,
  backend,
  show,
  stopShowing,
  addNewKey,
}) {
  useEffect(() => {
    Modal.setAppElement("#account-root");
  });

  const onRequestClose = () => {
    if (passwordInputs.inputs.filter((e) => e === IS_UPLOADING).length === 0) {
      stopShowing();
    }
  };

  let _changeOne = (inputs, index, newInput) => {
    return [...inputs.slice(0, index), newInput, ...inputs.slice(index + 1)];
  };
  let reducePasswordInputs = (state, action) => {
    if (action.type === ADD) {
      return {
        inputs: [...state.inputs, NOT_UPLOADING],
        numActivePasswordInputs: state.numActivePasswordInputs + 1,
      };
    }
    if (action.type === REMOVE) {
      return {
        inputs: _changeOne(state.inputs, action.index, null),
        numActivePasswordInputs: state.numActivePasswordInputs - 1,
      };
    }
    if (action.type === CHANGE_ONE) {
      return {
        inputs: _changeOne(state.inputs, action.index, action.newInput),
        numActivePasswordInputs: state.numActivePasswordInputs,
      };
    }
    if (action.type === SAVE_ALL) {
      return {
        inputs: state.inputs.map((x) => (x !== null ? IS_UPLOADING : null)),
        numActivePasswordInputs: state.numActivePasswordInputs,
      };
    }
  };
  let addPasswordInput = () => {
    updatePasswordInputs({ type: ADD });
  };
  let removePasswordInput = (i) => {
    updatePasswordInputs({ type: REMOVE, index: i });
  };
  let saveAllPasswords = () => {
    updatePasswordInputs({ type: SAVE_ALL });
  };
  const [passwordInputs, updatePasswordInputs] = useReducer(
    reducePasswordInputs,
    { inputs: [NOT_UPLOADING], numActivePasswordInputs: 1 }
  );

  let getCommunicateUploadStateCallback = (el, index) => {
    if (el === IS_UPLOADING) {
      return (newState) => {
        if (newState === UPLOAD_GOOD) {
          // Allows check mark to show up but need to work on animation.
          setTimeout(() => {
            removePasswordInput(index);
          }, 2000);
        } else if (newState === UPLOAD_BAD) {
          updatePasswordInputs({
            type: CHANGE_ONE,
            index,
            newInput: NOT_UPLOADING,
          });
        }
      };
    }
    return null;
  };

  let showRemoveMe = passwordInputs.numActivePasswordInputs > 1;

  return (
    <div key="AddPasswords">
      <Modal
        isOpen={show}
        onRequestClose={onRequestClose}
        style={customStyles}
        contentLabel="Manually Add Password"
        closeTimeoutMS={200}
      >
        <div>
          <h2 style={{ textAlign: "center" }}>Manually Add Password</h2>
          <div className="Password-inputs-container">
            {passwordInputs.inputs.map(
              (el, i) =>
                el !== null && (
                  <PasswordInput
                    key={i}
                    showRemoveMe={showRemoveMe}
                    removeMe={() => {
                      removePasswordInput(i);
                    }}
                    communicateUploadState={getCommunicateUploadStateCallback(
                      el,
                      i
                    )}
                    password={password}
                    en_pw={en_pw}
                    en_user={en_user}
                    backend={backend}
                    addNewKey={addNewKey}
                  />
                )
            )}
          </div>
          <Button
            onClick={addPasswordInput}
            variant="outlined"
            type="button"
            sx={{
              marginTop: "24px",
              width: "100%",
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
          >
            add another
          </Button>
          <div></div>
          <Button
            onClick={saveAllPasswords}
            variant="outlined"
            type="button"
            sx={{
              marginTop: "12px",
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
          >
            Save all
          </Button>
        </div>
      </Modal>
    </div>
  );
}
