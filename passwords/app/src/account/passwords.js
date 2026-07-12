import { useState } from "react";
import { showLoader, hideLoader } from "../loader/loader";
import { encryptPwWithKey } from "../crypto/encrypt";
import { apiNewPassword, apiCreateBucket } from "../api";
import BucketView from "./bucket";
import Autocomplete from "@mui/material/Autocomplete";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import AlertTitle from "@mui/material/AlertTitle";
import CopyToClipboard from "react-copy-to-clipboard";
import { KeyBinds } from "../util";
import "./account.css";

export function QueryBucket({
  backend,
  auth,
  aesKey,
  keys,
  updateKey,
  removeKey,
  setErrorMsg
}) {
  const [selectedKey, setSelectedKey] = useState(null);

  const onAcChange = (e, newKey, reason) => {
    if (newKey !== null) {
      setSelectedKey(newKey);
    }
  };

  return (
    <div className="Password-container">
      <div className="Password-header">Select a bucket to view:</div>
      <Autocomplete
        disablePortal
        id="my-id"
        sx={{
          width: "100%",
          color: "blue",
          "& .MuiSvgIcon-root": {
            color: "black"
          },
          "& .MuiIconButton-root ": {
            marginLeft: "6px"
          }
        }}
        options={keys ? keys : []}
        autoComplete={true}
        autoSelect={true}
        autoHighlight={true}
        clearOnBlur={true}
        clearOnEscape={true}
        selectOnFocus={true}
        readOnly={keys === undefined}
        renderInput={(s) => (
          <TextField
            {...s}
            autoFocus={true}
            label={keys === undefined ? "Loading..." : "Select a bucket"}
            sx={{
              marginTop: "12px",
              marginBottom: "24px",
              fieldset: { borderColor: "black" },
              input: { color: "black" },
              label: { color: "black" },
              "& .MuiOutlinedInput-root": {
                "&.Mui-focused fieldset": {
                  borderColor: "#3f50b5"
                }
              },
              "&:hover fieldset": {
                borderColor: "#3f50b5 !important"
              }
            }}
            InputLabelProps={{
              sx: { "&.Mui-focused": { color: "#3f50b5" } }
            }}
          />
        )}
        onChange={onAcChange}
      />
      {selectedKey !== null && (
        <BucketView
          backend={backend}
          auth={auth}
          aesKey={aesKey}
          bucketKey={selectedKey}
          onRenamed={(oldKey, newKey) => {
            updateKey(oldKey, newKey);
            setSelectedKey(newKey);
          }}
          onDeleted={(key) => {
            removeKey(key);
            setSelectedKey(null);
          }}
          setErrorMsg={setErrorMsg}
        />
      )}
    </div>
  );
}

export function NewBucket({
  backend,
  auth,
  aesKey,
  keys,
  addNewKey,
  setErrorMsg
}) {
  const [key, setKey] = useState("");
  const [keyError, setKeyError] = useState("");
  const [copyText, setCopyText] = useState("");
  const [open, setOpen] = useState(false);

  const onKeyPress = (e) => {
    if (e.charCode === KeyBinds.ENTER) {
      submit();
    }
  };

  const handleClick = () => {
    setOpen(true);
  };

  const handleClose = (event, reason) => {
    if (reason === "clickaway") {
      return;
    }

    setOpen(false);
  };

  const submit = async () => {
    if (key === "") {
      setErrorMsg("Must specify a name for the new bucket.");
      return;
    }
    if (key.length > 128) {
      setErrorMsg("Bucket name is too long (max 128 characters).");
      return;
    }
    if (keys !== undefined && keys.includes(key)) {
      setErrorMsg("You already have a bucket of this name!");
      return;
    }
    showLoader();
    setCopyText("");
    try {
      const pwval = await apiNewPassword(backend);
      await apiCreateBucket(backend, auth, key, [
        {
          label: "password",
          en_value: encryptPwWithKey(aesKey, pwval),
          sensitive: true
        }
      ]);
      addNewKey(key);
      setKey("");
      setCopyText(pwval);
    } catch (e) {
      setErrorMsg("Encountered an error. Please try again.");
    } finally {
      hideLoader();
    }
  };

  const action = (
    <>
      <Button
        sx={{
          color: "white",
          backgroundColor: "#3f50b5",
          ":hover": {
            backgroundColor: "#282c34"
          },
          borderRadius: "4px"
        }}
        color="primary"
        variant="contained"
        size="small"
        onClick={handleClose}
      >
        Close
      </Button>
    </>
  );

  return (
    <div className="Password-container">
      <div className="Password-header">Enter a name for your new bucket!</div>
      <TextField
        label="New bucket name"
        type="text"
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
        value={key}
        autoFocus={true}
        onKeyPress={onKeyPress}
        sx={{
          width: "100%",
          marginTop: "12px",
          marginBottom: "24px",
          fieldset: { borderColor: "black" },
          input: { color: "black" },
          label: { color: "black" },
          "& .MuiOutlinedInput-root": {
            "&.Mui-focused fieldset": {
              borderColor: "#3f50b5"
            }
          },
          "&:hover fieldset": {
            borderColor: "#3f50b5 !important"
          }
        }}
        InputLabelProps={{
          sx: { "&.Mui-focused": { color: "#3f50b5" } }
        }}
      />
      <Button
        disabled={keyError !== ""}
        sx={{
          width: "100%",
          height: "45px",
          borderRadius: "8px",
          marginTop: "8px",
          backgroundColor: "#282c34",
          ":hover": {
            backgroundColor: "#3f50b5"
          },
          fontWeight: "bold",
          color: "white"
        }}
        type="button"
        onClick={submit}
      >
        Create
      </Button>
      <div style={{ width: "100%", marginTop: "16px" }}>
        {copyText !== "" && (
          <div style={{ width: "100%" }}>
            <CopyToClipboard
              onCopy={() => {
                handleClick();
              }}
              text={copyText}
            >
              <Alert
                sx={{
                  textAlign: "left",
                  ":hover": {
                    backgroundColor: "black",
                    cursor: "copy"
                  }
                }}
                severity="info"
              >
                <AlertTitle>Bucket created with a new password!</AlertTitle>
                Click here to copy.
              </Alert>
            </CopyToClipboard>
          </div>
        )}
      </div>
      <Snackbar
        open={open}
        autoHideDuration={6000}
        onClose={handleClose}
        message="Password Copied!"
        action={action}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </div>
  );
}
