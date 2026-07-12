import { useState, useEffect, useMemo, useCallback } from "react";
import SettingsModal from "./settings/settings";
import { QueryBucket, NewBucket } from "./passwords";
import AddPasswordsModal from "./addpasswords";
import { apiGetBucketKeys } from "../api";
import { showLoader, hideLoader } from "../loader/loader";
import { errorColor, backgroundColor } from "../theme";
import "./account.css";
import userIcon from "../assets/icons/user-inverted.png";
import Fab from "@mui/material/Fab";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import List from "@mui/material/List";
import Divider from "@mui/material/Divider";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import SettingsIcon from "@mui/icons-material/Settings";
import LogoutIcon from "@mui/icons-material/Logout";
import AddIcon from "@mui/icons-material/AddCircle";

const TOGGLE_VIEW_DELAY_IN_MS = 300;
const ERROR_MSG_TIME_IN_MS = 10000;

export default function Account({
  username,
  en_user,
  backend,
  aesKey,
  en_pw,
  reset
}) {
  let [isQueryView, setIsQueryView] = useState(true); // true == queryView; false == newPasswordView
  let [showSettings, setShowSettings] = useState(false);
  let [showAddPasswords, setShowAddPasswords] = useState(false);
  let [currAesKey, setCurrAesKey] = useState(aesKey);
  let [currEnPw, setCurrEnPw] = useState(en_pw);
  const [open, setOpen] = useState(false);

  const auth = useMemo(
    () => ({ en_user, en_pw: currEnPw }),
    [en_user, currEnPw]
  );

  let [keys, setKeys] = useState(undefined);
  const addNewKey = (newKey) => {
    setKeys((prevKeys) =>
      prevKeys === undefined ? [newKey] : prevKeys.concat([newKey])
    );
  };
  const updateKey = (oldKey, newKey) => {
    setKeys((prevKeys) =>
      prevKeys === undefined
        ? prevKeys
        : prevKeys.map((k) => (k === oldKey ? newKey : k))
    );
  };
  const removeKey = (key) => {
    setKeys((prevKeys) =>
      prevKeys === undefined ? prevKeys : prevKeys.filter((k) => k !== key)
    );
  };
  useEffect(() => {
    if (keys === undefined) {
      showLoader();
      apiGetBucketKeys(backend, auth)
        .then((updatedKeys) => {
          setKeys(updatedKeys);
        })
        .catch(() => {
          setErrorMsg("Unable to retrieve stored passwords at this time.");
        })
        .finally(() => {
          hideLoader();
        });
    }
  });

  const [errorMsg, setErrorMsgHook] = useState("");
  const setErrorMsg = useCallback((msg) => {
    setTimeout(() => {
      setErrorMsgHook("");
    }, ERROR_MSG_TIME_IN_MS);
    setErrorMsgHook(msg);
  }, []);

  const setQueryView = (b) => {
    showLoader();
    setTimeout(() => {
      hideLoader();
      setIsQueryView(b);
    }, TOGGLE_VIEW_DELAY_IN_MS);
  };

  const toggleDrawer = (newOpen) => {
    setOpen(newOpen);
  };

  const DrawerList = (
    <Box
      sx={{ width: 250 }}
      role="presentation"
      onClick={() => toggleDrawer(false)}
    >
      <List>
        <ListItem key="username" disablePadding>
          <ListItemText
            primaryTypographyProps={{
              fontSize: "18px",
              fontWeight: "bold",
              marginLeft: "24px",
              marginRight: "24px"
            }}
            sx={{
              overflowWrap: "break-word"
            }}
            primary={username}
          />
        </ListItem>
      </List>
      <List>
        <ListItem key="AddPasswords" disablePadding>
          <ListItemButton
            onClick={() => {
              setShowAddPasswords(true);
            }}
          >
            <ListItemIcon>
              <AddIcon />
            </ListItemIcon>
            <ListItemText primary={"Manually Add Passwords"} />
          </ListItemButton>
        </ListItem>
        <ListItem key="Settings" disablePadding>
          <ListItemButton
            onClick={() => {
              setShowSettings(true);
            }}
          >
            <ListItemIcon>
              <SettingsIcon />
            </ListItemIcon>
            <ListItemText primary={"Settings"} />
          </ListItemButton>
        </ListItem>
      </List>
      <Divider />
      <List>
        <ListItem key="LogOut" disablePadding>
          <ListItemButton onClick={reset}>
            <ListItemIcon>
              <LogoutIcon />
            </ListItemIcon>
            <ListItemText primary={"Log Out"} />
          </ListItemButton>
        </ListItem>
      </List>
    </Box>
  );

  return (
    <div id="account-root" className="Account">
      <div className="Account-dropdown">
        <div className="user" onClick={() => toggleDrawer(true)}>
          <img src={userIcon} alt="user" />
        </div>
        <Drawer open={open} onClose={() => toggleDrawer(false)}>
          {DrawerList}
        </Drawer>
      </div>
      <div className="Account-info">
        {isQueryView ? (
          <QueryBucket
            backend={backend}
            auth={auth}
            aesKey={currAesKey}
            keys={keys}
            updateKey={updateKey}
            removeKey={removeKey}
            setErrorMsg={setErrorMsg}
          />
        ) : (
          <NewBucket
            backend={backend}
            auth={auth}
            aesKey={currAesKey}
            keys={keys}
            addNewKey={addNewKey}
            setErrorMsg={setErrorMsg}
          />
        )}
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
        {!showSettings && (
          <Fab
            variant="extended"
            onClick={() => {
              setQueryView(!isQueryView);
            }}
            sx={{
              position: "absolute",
              left: 20,
              bottom: 20,
              backgroundColor: "#3f50b5",
              color: "white",
              fontWeight: "bold",
              ":hover": {
                backgroundColor: "#282c34"
              }
            }}
          >
            {isQueryView ? "Add a new bucket" : "View existing buckets"}
          </Fab>
        )}
      </div>
      <SettingsModal
        username={username}
        en_user={en_user}
        aesKey={currAesKey}
        en_pw={currEnPw}
        backend={backend}
        setAesKey={setCurrAesKey}
        setEnPassword={setCurrEnPw}
        show={showSettings}
        stopShowing={() => setShowSettings(false)}
      />
      <AddPasswordsModal
        aesKey={currAesKey}
        en_user={en_user}
        en_pw={currEnPw}
        backend={backend}
        show={showAddPasswords}
        stopShowing={() => setShowAddPasswords(false)}
        addNewKey={addNewKey}
      />
    </div>
  );
}
