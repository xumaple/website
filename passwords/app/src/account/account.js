import { useState, useEffect } from "react";
import SettingsModal from "./settings/settings";
import { QueryPassword, NewPassword } from "./passwords";
import { showLoader, hideLoader } from "../loader/loader";
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

const TOGGLE_VIEW_DELAY_IN_MS = 300;

export default function Account({
  username,
  en_user,
  backend,
  password,
  en_pw,
  reset
}) {
  // const theme = useTheme();
  let [isQueryView, setIsQueryView] = useState(true); // true == queryView; false == newPasswordView
  let [showDropdown, setShowDropdown] = useState(false);
  let [showSettings, setShowSettings] = useState(false);
  let [currPassword, setCurrPassword] = useState(password);
  let [currEnPw, setCurrEnPw] = useState(en_pw);
  const [open, setOpen] = useState(false);

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
        `${backend}/api/v1/get/getkeys?username=${en_user}&password=${currEnPw}`,
        {
          method: "GET"
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
        <ListItem key={Account} disablePadding>
          <ListItemText
            primaryTypographyProps={{
              fontSize: "18px",
              fontWeight: "bold",
              marginLeft: "16px"
            }}
            primary={username}
          />
        </ListItem>
      </List>
      <List>
        <ListItem key={Account} disablePadding>
          <ListItemButton
            onClick={() => {
              setShowSettings(true);
              setShowDropdown(false);
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
        <ListItem key={Account} disablePadding>
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
        {/* <div className={showDropdown ? "menu active" : "menu"}>
          <span style={{ fontSize: "calc(8px + 2vmin)" }}>
            {username}
            <br />
          </span>
          <ul>
            <li>
            <img src="../assets/icons/user.png" /><a href="#">My profile</a>
          </li>
          <li>
            <img src="../assets/icons/edit.png" /><a href="#">Edit profile</a>
          </li>
          <li>
            <img src="../assets/icons/envelope.png" /><a href="#">Inbox</a>
          </li>
        <li><img src="../assets/icons/question.png" /><a href="#">Help</a></li>
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                backgroundColor: "blue"
              }}
            >
              <AddIcon></AddIcon>
              <div
                onClick={() => {
                  setShowSettings(true);
                  setShowDropdown(false);
                }}
                style={{ fontSize: "24px" }}
              >
                Settings
              </div>
            </div>
            <li>
              <img src={logoIcon} alt="" />
              <div onClick={reset}>Logout</div>
            </li>
          </ul>
        </div> */}
      </div>
      <div className="Account-info">
        {isQueryView ? (
          <QueryPassword
            backend={backend}
            en_user={en_user}
            password={currPassword}
            en_pw={currEnPw}
            keys={keys}
            setErrorMsg={setErrorMsg}
          />
        ) : (
          <NewPassword
            backend={backend}
            en_user={en_user}
            password={currPassword}
            en_pw={currEnPw}
            keys={keys}
            addNewKey={addNewKey}
            setErrorMsg={setErrorMsg}
          />
        )}
        {showSettings ? (
          ""
        ) : (
          <Fab
            variant="extended"
            onClick={() => {
              setQueryView(!isQueryView);
              setShowDropdown(false);
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
            {isQueryView ? "Add new password" : "Query an existing password"}
          </Fab>
        )}
      </div>
      <SettingsModal
        username={username}
        en_user={en_user}
        en_pw={currEnPw}
        backend={backend}
        setPassword={setCurrPassword}
        show={showSettings}
        stopShowing={() => setShowSettings(false)}
      />
    </div>
  );
}
