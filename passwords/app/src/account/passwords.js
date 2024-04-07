import { useState, useEffect } from "react";
import { showLoader, hideLoader } from "../loader/loader";
import { encryptPw, decryptPw } from "../crypto/encrypt";
import Autocomplete from "@mui/material/Autocomplete";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import AlertTitle from "@mui/material/AlertTitle";
import IconButton from "@mui/material/IconButton";
import CopyToClipboard from "react-copy-to-clipboard";
import copy from "copy-to-clipboard";
import { KeyBinds } from "../util";
import "./account.css";

export function QueryPassword({
  backend,
  en_user,
  password,
  en_pw,
  keys,
  setErrorMsg,
}) {
  let [kvs, setKvs] = useState({});
  let [retrieved, setRetrieved] = useState("");
  const [open, setOpen] = useState(false);

  const onAcChange = (e, newKey, reason) => {
    if (newKey !== null) {
      if (!(newKey in kvs)) {
        fetch(
          `${backend}/api/v1/get/getpw/${encodeURIComponent(
            newKey
          )}?username=${encodeURIComponent(
            en_user
          )}&password=${encodeURIComponent(en_pw)}`,
          {
            method: "GET",
          }
        )
          .then((response) => {
            if (response.status !== 200) {
              console.log(response);
              throw new Error("Error while trying to get passwords.");
            }
            return response.json();
          })
          .then((s) => {
            if (!(newKey in kvs)) {
              kvs[newKey] = decryptPw(password, s);
              setKvs(kvs);
            }
            setRetrieved(newKey);
          })
          .catch((e) => {
            console.error(e);
            setErrorMsg("Unable to retrieve stored passwords at this time.");
          })
          .finally(() => {
            console.log("Finished retrieving pw");
            hideLoader();
          });
      } else {
        setRetrieved(newKey);
      }
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

  const action = (
    <>
      <Button
        sx={{
          color: "white",
          backgroundColor: "#3f50b5",
          ":hover": {
            backgroundColor: "#282c34",
          },
          borderRadius: "4px",
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
      <div className="Password-header">Select a password to retrieve:</div>
      <Autocomplete
        disablePortal
        id="my-id"
        sx={{
          width: "100%",
          color: "blue",
          "& .MuiSvgIcon-root": {
            color: "black",
          },
          "& .MuiIconButton-root ": {
            marginLeft: "6px",
          },
        }}
        options={keys ? keys : []}
        autoComplete={true}
        autoSelect={true}
        autoHighlight={true}
        clearOnBlur={true}
        clearOnEscape={true}
        // openOnFocus={true}
        selectOnFocus={true}
        readOnly={keys === undefined}
        renderInput={(s) => (
          <TextField
            {...s}
            autoFocus={true}
            label={keys === undefined ? "Loading..." : "Select a password key"}
            sx={{
              marginTop: "12px",
              marginBottom: "24px",
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
        )}
        onChange={onAcChange}
        // onInputChange={setInputValue}
      />
      {retrieved === "" ? (
        ""
      ) : (
        <div style={{ width: "100%" }}>
          <CopyToClipboard
            onCopy={() => {
              handleClick();
            }}
            text={kvs[retrieved]}
          >
            <Alert
              sx={{
                textAlign: "left",
                ":hover": {
                  backgroundColor: "black",
                },
              }}
              severity="info"
            >
              <AlertTitle> Retrieved password for {retrieved}!</AlertTitle>
              Click here to copy.
            </Alert>
          </CopyToClipboard>
          {/* <CopyText text={kvs[retrieved]} copyOnLoad={false} /> */}
        </div>
      )}
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

export function NewPassword({
  backend,
  en_user,
  password,
  en_pw,
  keys,
  addNewKey,
  setErrorMsg,
}) {
  const [key, setKey] = useState("");
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

  const submit = () => {
    if (key === "") {
      setErrorMsg("Must specify a key to generate.");
    }
    if (key in keys) {
      setErrorMsg("You already have a key of this name!");
    }
    showLoader();
    fetch(`${backend}/api/v1/get/newpw`, {
      method: "GET",
    })
      .then((response) => {
        if (response.status !== 200) {
          console.log(response);
          throw new Error("Error while trying to get new password.");
        }
        return response.json();
      })
      .then((pwval) => {
        fetch(
          `${backend}/api/v1/post/newpw/${encodeURIComponent(
            key
          )}?username=${encodeURIComponent(
            en_user
          )}&password=${encodeURIComponent(en_pw)}&pwval=${encodeURIComponent(
            encryptPw(password, pwval)
          )}`,
          {
            method: "POST",
          }
        ).then((response) => {
          if (response.status !== 200) {
            console.log(response);
            throw new Error("Error while trying to store new password.");
          }
          addNewKey(key);
          setKey("");
          setCopyText(pwval);
        });
      })
      .finally(() => {
        hideLoader();
      });
  };

  const action = (
    <>
      <Button
        sx={{
          color: "white",
          backgroundColor: "#3f50b5",
          ":hover": {
            backgroundColor: "#282c34",
          },
          borderRadius: "4px",
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
      <div className="Password-header">Enter a keyname for your password!</div>
      <TextField
        label="New Keyname"
        type="text"
        onChange={(e) => {
          setKey(e.target.value);
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
      <Button
        sx={{
          width: "100%",
          height: "45px",
          borderRadius: "8px",
          marginTop: "8px",
          backgroundColor: "#282c34",
          ":hover": {
            backgroundColor: "#3f50b5",
          },
          fontWeight: "bold",
          color: "white",
        }}
        type="button"
        onClick={submit}
      >
        Generate
      </Button>
      <div style={{ width: "100%", marginTop: "16px" }}>
        {copyText === "" ? (
          ""
        ) : (
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
                  },
                }}
                severity="info"
              >
                <AlertTitle>Generated a new password!</AlertTitle>
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

function CopyText({ text, copyOnLoad }) {
  const [copied, setCopied] = useState(copyOnLoad);
  // If copyOnLoad==true, then showPrompt starts out false and then
  // useEffect() will change to true. Else, showPrompt starts out
  // true to give user an opportunity to copy.
  const [showPrompt, setShowPrompt] = useState(!copyOnLoad);
  const [showAlert, setShowAlert] = useState(false);

  useEffect(() => {
    if (copyOnLoad && text !== "") {
      console.log("copying");
      copy(text);
      setCopied(true);
      if (showPrompt === false) {
        setTimeout(() => {
          setShowPrompt(true);
        }, 1500);
      } else {
        setShowAlert(true);
      }
    }
  }, [text]);

  if (text === null) {
    return <div></div>;
  }
  return (
    <div className="copy">
      <div
        className={`copy-alert ${
          showAlert ? "copy-alert-shown" : "copy-alert-hidden"
        }`}
        // onTransitionEnd={() => {
        //   setShowAlert(false);
        // }}
      >
        Copied!
      </div>
      <CopyToClipboard
        text={text}
        onCopy={() => {
          setShowAlert(true);
          setCopied(true);
        }}
      >
        <div
          className={`copy-prompt ${
            showPrompt ? "copy-prompt-shown" : "copy-prompt-hidden"
          }`}
          onMouseEnter={() => {
            setShowAlert(false);
          }}
        >
          Click <span className="copy-prompt-press">here</span> to copy
          {copied ? " again" : ""}.
        </div>
      </CopyToClipboard>
    </div>
  );
}
