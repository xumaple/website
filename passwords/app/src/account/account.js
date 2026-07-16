import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import SettingsModal from "./settings/settings";
import { QueryAccount, NewAccount } from "./passwords";
import { apiGetBucketKeys } from "../api";
import { showLoader, hideLoader } from "../loader/loader";
import { errorColor, backgroundColor } from "../theme";
import { ACCENT, INK, primarySmallButtonSx } from "./styles";
import {
  biometricLabel,
  isBiometricAvailable,
  isBiometricEnrolled,
  isBiometricPromoDismissed,
  dismissBiometricPromo,
  enrollBiometric,
} from "../crypto/biometric";
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
import Button from "@mui/material/Button";
import Snackbar from "@mui/material/Snackbar";

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
  // Only one keys fetch may be in flight: this effect runs after every
  // render, and without the guard a slow response can overlap newer state
  // (e.g. resolve after accounts were added) and clobber the keys list.
  const keysFetchInFlight = useRef(false);
  useEffect(() => {
    if (keys === undefined && !keysFetchInFlight.current) {
      keysFetchInFlight.current = true;
      showLoader();
      apiGetBucketKeys(backend, auth)
        .then((updatedKeys) => {
          setKeys(updatedKeys);
        })
        .catch(() => {
          setErrorMsg("Unable to retrieve your accounts at this time.");
        })
        .finally(() => {
          keysFetchInFlight.current = false;
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

  // Offer biometric unlock once per login for users who haven't set it up
  // and haven't said "Not now". "offer" shows Enable / Not now; "done"
  // confirms after a successful enrollment.
  const [bioPromo, setBioPromo] = useState(null);
  useEffect(() => {
    if (isBiometricEnrolled() || isBiometricPromoDismissed()) return;
    let cancelled = false;
    isBiometricAvailable().then((ok) => {
      if (ok && !cancelled) setBioPromo("offer");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enableBiometricFromPromo = async () => {
    try {
      await enrollBiometric({
        username,
        en_user,
        aesKey: currAesKey,
        en_pw: currEnPw,
      });
      setBioPromo("done");
    } catch (e) {
      // A cancelled OS prompt keeps the offer available on the next login;
      // "Not now" is the only way to opt out of seeing it.
      setBioPromo(null);
      if (!(e && e.name === "NotAllowedError")) {
        setErrorMsg(`Unable to turn on ${biometricLabel()}.`);
      }
    }
  };

  const declineBiometricPromo = () => {
    dismissBiometricPromo();
    setBioPromo(null);
  };

  // If the user enrolls from the settings modal while the offer is up,
  // retire the offer instead of re-showing it when settings closes.
  useEffect(() => {
    if (!showSettings && bioPromo === "offer" && isBiometricEnrolled()) {
      setBioPromo(null);
    }
  }, [showSettings, bioPromo]);

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
        {/* Future: an "Import accounts (CSV)" drawer item will go here. */}
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
          <QueryAccount
            backend={backend}
            auth={auth}
            aesKey={currAesKey}
            keys={keys}
            updateKey={updateKey}
            removeKey={removeKey}
            setErrorMsg={setErrorMsg}
          />
        ) : (
          <NewAccount
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
              backgroundColor: ACCENT,
              color: "white",
              fontWeight: "bold",
              ":hover": {
                backgroundColor: INK
              }
            }}
          >
            {isQueryView ? "Add a new account" : "View accounts"}
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
      {/* Top-center so it never collides with the bottom "Copied …"
          snackbars; auto-hiding is not a permanent dismissal ("Not now" is). */}
      <Snackbar
        open={bioPromo !== null && !showSettings}
        autoHideDuration={bioPromo === "done" ? 5000 : 15000}
        onClose={(e, reason) => reason !== "clickaway" && setBioPromo(null)}
        message={
          bioPromo === "done"
            ? `${biometricLabel()} turned on.`
            : `Use ${biometricLabel()} instead of your password next time?`
        }
        action={
          bioPromo === "done" ? (
            <Button
              sx={primarySmallButtonSx}
              color="primary"
              variant="contained"
              size="small"
              onClick={() => setBioPromo(null)}
            >
              Close
            </Button>
          ) : (
            <>
              <Button
                sx={primarySmallButtonSx}
                color="primary"
                variant="contained"
                size="small"
                onClick={enableBiometricFromPromo}
              >
                Enable
              </Button>
              <Button
                color="inherit"
                size="small"
                sx={{ marginLeft: "8px" }}
                onClick={declineBiometricPromo}
              >
                Not now
              </Button>
            </>
          )
        }
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
      />
    </div>
  );
}
