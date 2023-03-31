import { useState, useEffect } from "react";
import SettingsModal from "./settings/settings";
import { QueryPassword, NewPassword } from "./passwords";
import { showLoader, hideLoader } from "../loader/loader";
import "./account.css";
import logoIcon from "../assets/icons/log-out.png";
import userIcon from "../assets/icons/user-inverted.png";
import settingsIcon from "../assets/icons/settings.png";
import { useTheme } from "@mui/material/styles";

const TOGGLE_VIEW_DELAY_IN_MS = 300;

export default function Account({ username, backend, password, reset }) {
  // const theme = useTheme();
  let [isQueryView, setIsQueryView] = useState(true); // true == queryView; false == newPasswordView
  let [showDropdown, setShowDropdown] = useState(false);
  let [showSettings, setShowSettings] = useState(false);
  let [currPassword, setCurrPassword] = useState(password);

  let [keys, setKeys] = useState(undefined);
  const addNewKey = (newKey) => {
    if (keys === undefined) {
      setKeys([newKey]);
    } else {
      setKeys(keys.concat([newKey]));
    }
  };
  useEffect(() => {
    if (keys === undefined) {
      showLoader();
      fetch(
        `${backend}/api/v1/get/getkeys?username=${username}&password=${currPassword}`,
        {
          method: "GET",
        }
      )
        .then((response) => {
          if (response.status !== 200) {
            console.log(response);
            throw new Error("Error while trying to get keys.");
          }
          return response.json();
        })
        .then((updatedKeys) => {
          setKeys(updatedKeys);
        })
        .catch((e) => {
          console.error(e);
          setErrorMsg("Unable to retrieve stored passwords at this time.");
        })
        .finally(() => {
          console.log("Finished retrieving keys");
          hideLoader();
        });
    }
  });

  const setErrorMsg = (e) => {};

  const setQueryView = (b) => {
    showLoader();
    setTimeout(() => {
      hideLoader();
      setIsQueryView(b);
    }, TOGGLE_VIEW_DELAY_IN_MS);
  };

  return (
    <div id="account-root" className="Account">
      <div className="Account-dropdown">
        <div className="user" onClick={() => setShowDropdown(!showDropdown)}>
          <img src={userIcon} alt="user" />
        </div>
        <div className={showDropdown ? "menu active" : "menu"}>
          <h3>
            {username}
            <br />
          </h3>
          <ul>
            {/* <li>
            <img src="../assets/icons/user.png" /><a href="#">My profile</a>
          </li>
          <li>
            <img src="../assets/icons/edit.png" /><a href="#">Edit profile</a>
          </li>
          <li>
            <img src="../assets/icons/envelope.png" /><a href="#">Inbox</a>
          </li>
        <li><img src="../assets/icons/question.png" /><a href="#">Help</a></li> */}
            <li>
              <img src={settingsIcon} alt="" />
              <div
                onClick={() => {
                  setShowSettings(true);
                  setShowDropdown(false);
                }}
              >
                Settings
              </div>
            </li>
            <li>
              <img src={logoIcon} alt="" />
              <div onClick={reset}>Logout</div>
            </li>
          </ul>
        </div>
      </div>
      <div className="Account-info">
        {isQueryView ? (
          <QueryPassword
            backend={backend}
            user={username}
            password={currPassword}
            keys={keys}
            setErrorMsg={setErrorMsg}
          />
        ) : (
          <NewPassword
            backend={backend}
            user={username}
            password={currPassword}
            keys={keys}
            addNewKey={addNewKey}
            setErrorMsg={setErrorMsg}
          />
        )}
        {showSettings ? (
          ""
        ) : (
          <button
            className="toggle"
            onClick={() => {
              setQueryView(!isQueryView);
              setShowDropdown(false);
            }}
          >
            {isQueryView
              ? "Generate a new password instead"
              : "Query an existing password"}
          </button>
        )}
      </div>
      <SettingsModal
        username={username}
        password={currPassword}
        backend={backend}
        setPassword={setCurrPassword}
        show={showSettings}
        stopShowing={() => setShowSettings(false)}
      />
    </div>
  );
}
