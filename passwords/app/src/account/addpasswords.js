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
    backgroundColor: "black",
    opacity: 1,
  },
  overlay: {
    backgroundColor: "rgba(255, 255, 255, 0.4)",
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
    setInnerUploadState(UPLOAD_PENDING);
    setCurrentlyUploading(true);

    fetch(
      `${backend}/api/v1/post/newpw/${encodeURIComponent(
        key
      )}?username=${encodeURIComponent(en_user)}&password=${encodeURIComponent(
        en_pw
      )}&pwval=${encodeURIComponent(encryptPw(password, pw))}`,
      {
        method: "POST",
      }
    )
      .then((response) => {
        if (response.status !== 200) {
          setUploadState(UPLOAD_BAD);
          console.log("fetching with", key, pw);
          console.log(response);
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
      return currentlyUploading ? <WaitingCircle /> : "";
    }
    if (status === UPLOAD_GOOD) {
      return <GoodCircle />;
    }
    if (status === UPLOAD_BAD) {
      return <BadCircle />;
    }
    return "";
  };

  return (
    <div>
      {showRemoveMe && !currentlyUploading ? (
        <Cancel
          onClick={() => {
            removeMe();
          }}
        />
      ) : (
        ""
      )}
      <TextField
        type="text"
        label="key"
        onChange={(e) => {
          setKey(e.target.value);
        }}
        value={key}
      />
      <TextField
        type="password"
        label="password"
        onChange={(e) => {
          setPw(e.target.value);
        }}
        value={pw}
      />
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
        console.log("previous state: ", passwordInputs.inputs);
        if (newState === UPLOAD_GOOD) {
          removePasswordInput(index);
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
  console.log(passwordInputs.inputs);

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
          <h1>Manually Add Password</h1>
          {passwordInputs.inputs.map((el, i) =>
            el !== null ? (
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
            ) : (
              ""
            )
          )}

          <Button onClick={addPasswordInput}>add one</Button>
          <div></div>
          <Button onClick={saveAllPasswords}>Save all passwords</Button>
        </div>
      </Modal>
    </div>
  );
}
