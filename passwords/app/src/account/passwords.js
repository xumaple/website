import { useState, useEffect } from "react";
import { showLoader, hideLoader } from "../loader/loader";
import { encryptPw, decryptPw } from "../crypto/encrypt";
import Autocomplete from "@mui/material/Autocomplete";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import CopyToClipboard from "react-copy-to-clipboard";
import copy from "copy-to-clipboard";
import { KeyBinds } from "../util";
import "./account.css";

export function QueryPassword({ backend, user, password, keys, setErrorMsg }) {
  let [kvs, setKvs] = useState(new Object());
  let [retrieved, setRetrieved] = useState("");

  const onAcChange = (e, newKey, reason) => {
    if (newKey !== null) {
      if (!(newKey in kvs)) {
        fetch(
          `${backend}/api/v1/get/getpw/${encodeURIComponent(
            newKey
          )}?username=${encodeURIComponent(user)}&password=${encodeURIComponent(
            password
          )}`,
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

  return (
    <div>
      <div>Select a password to retrieve:</div>
      <Autocomplete
        className="ac"
        disablePortal
        id="my-id"
        sx={{ width: 300, color: "primary.light" }}
        options={keys}
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
          />
        )}
        onChange={onAcChange}
        // onInputChange={setInputValue}
      />
      {retrieved === "" ? (
        ""
      ) : (
        <div>
          <div className="copy">
            Retrieved password for key {retrieved} and{" "}
            <span className="copy-alert">copied</span> to your clipboard!{" "}
          </div>
          <CopyText text={kvs[retrieved]} />
        </div>
      )}
    </div>
  );
}

export function NewPassword({
  backend,
  user,
  password,
  keys,
  addNewKey,
  setErrorMsg,
}) {
  const [key, setKey] = useState("");
  const [copyText, setCopyText] = useState("");

  const onKeyPress = (e) => {
    if (e.charCode === KeyBinds.ENTER) {
      submit();
    }
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
          )}?username=${encodeURIComponent(user)}&password=${encodeURIComponent(
            password
          )}&pwval=${encodeURIComponent(encryptPw(password, pwval))}`,
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

  return (
    <div>
      <div>We need a key name for the new password we are generating!</div>
      <TextField
        label="New Keyname"
        type="text"
        onChange={(e) => {
          setKey(e.target.value);
        }}
        value={key}
        autoFocus={true}
        onKeyPress={onKeyPress}
      />
      <Button type="button" onClick={submit}>
        Generate
      </Button>
      <div>
        {copyText === "" ? (
          ""
        ) : (
          <div className="copy">
            Generated and <span className="copy-alert">copied</span> to your
            clipboard!{" "}
          </div>
        )}
        <CopyText text={copyText} />
      </div>
    </div>
  );
}

function CopyText({ text }) {
  const [showAlert, setShowAlert] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    if (text !== "") {
      copy(text);
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
          Click <span className="copy-prompt-press">here</span> to copy again.
        </div>
      </CopyToClipboard>
    </div>
  );
}
