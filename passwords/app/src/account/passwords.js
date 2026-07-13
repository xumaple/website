import { useState, useEffect, useCallback, useRef } from "react";
import { showLoader, hideLoader } from "../loader/loader";
import { encryptPwWithKey } from "../crypto/encrypt";
import { apiNewPassword, apiCreateBucket } from "../api";
import AccountView from "./bucket";
import Autocomplete from "@mui/material/Autocomplete";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import TextField from "@mui/material/TextField";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import AlertTitle from "@mui/material/AlertTitle";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import CopyToClipboard from "react-copy-to-clipboard";
import { KeyBinds } from "../util";
import {
  textFieldSx,
  inputLabelProps,
  primaryButtonSx,
  primarySmallButtonSx,
  secondaryButtonSx,
  dangerIconButtonSx,
  checkboxSx,
  checkboxLabelSx,
  copyBoxSx,
} from "./styles";
import "./account.css";

export function QueryAccount({
  backend,
  auth,
  aesKey,
  keys,
  updateKey,
  removeKey,
  setErrorMsg
}) {
  // The selection tracks both the account key and a stable per-selection id.
  // The id keys <AccountView> so that switching accounts remounts it with
  // fresh state, while renaming (same id, new key) keeps its state — e.g. an
  // open management panel — intact.
  const [selected, setSelected] = useState(null);
  const selectionCounter = useRef(0);

  const onAcChange = (e, newKey, reason) => {
    if (newKey !== null) {
      selectionCounter.current += 1;
      setSelected({ id: selectionCounter.current, key: newKey });
    }
  };

  return (
    <div className="Password-container">
      <div className="Password-header">Select an account to retrieve:</div>
      <Autocomplete
        disablePortal
        id="my-id"
        sx={{
          width: "100%",
          "& .MuiSvgIcon-root": {
            color: "black"
          },
          "& .MuiIconButton-root ": {
            marginLeft: "6px"
          }
        }}
        options={keys ? keys : []}
        value={selected === null ? null : selected.key}
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
            label={keys === undefined ? "Loading..." : "Select an account"}
            sx={{
              marginTop: "12px",
              ...textFieldSx
            }}
            InputLabelProps={inputLabelProps}
          />
        )}
        onChange={onAcChange}
      />
      {selected !== null && (
        <AccountView
          key={selected.id}
          backend={backend}
          auth={auth}
          aesKey={aesKey}
          bucketKey={selected.key}
          onRenamed={(oldKey, newKey) => {
            updateKey(oldKey, newKey);
            setSelected((prev) =>
              prev === null ? prev : { id: prev.id, key: newKey }
            );
          }}
          onDeleted={(key) => {
            removeKey(key);
            setSelected(null);
          }}
          setErrorMsg={setErrorMsg}
        />
      )}
    </div>
  );
}

// The password detail is just the first pre-added row of the form; it can be
// edited, generated into, or removed like any other detail row.
const makePasswordRow = () => ({ label: "password", value: "", secret: true });
const makeEmptyRow = () => ({ label: "", value: "", secret: false });

export function NewAccount({
  backend,
  auth,
  aesKey,
  keys,
  addNewKey,
  setErrorMsg
}) {
  const [key, setKey] = useState("");
  const [keyError, setKeyError] = useState("");
  const [details, setDetails] = useState([makePasswordRow()]);
  const [created, setCreated] = useState(null);
  const [copiedMsg, setCopiedMsg] = useState(null);

  // Pre-populate the pre-added password row with a generated password, but
  // never overwrite something the user has already typed (or a row they
  // relabeled/removed) if the response comes back late.
  const prefillPassword = useCallback(async () => {
    try {
      const generated = await apiNewPassword(backend);
      setDetails((prev) =>
        prev.map((d, i) =>
          i === 0 && d.label === "password" && d.value === ""
            ? { ...d, value: generated }
            : d
        )
      );
    } catch (e) {
      // Not fatal: the user can still type a password or press Generate.
    }
  }, [backend]);

  useEffect(() => {
    prefillPassword();
  }, [prefillPassword]);

  const onKeyPress = (e) => {
    if (e.charCode === KeyBinds.ENTER) {
      submit();
    }
  };

  const handleClose = (event, reason) => {
    if (reason === "clickaway") {
      return;
    }

    setCopiedMsg(null);
  };

  const addDetail = () => {
    setDetails(details.concat([makeEmptyRow()]));
  };

  const updateDetail = (index, patch) => {
    setDetails(details.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  };

  const removeDetail = (index) => {
    setDetails(details.filter((d, i) => i !== index));
  };

  const generateInto = async (index) => {
    try {
      const generated = await apiNewPassword(backend);
      updateDetail(index, { value: generated });
    } catch (e) {
      setErrorMsg("Encountered an error. Please try again.");
    }
  };

  const submit = async () => {
    if (key === "") {
      setErrorMsg("Must specify an account name.");
      return;
    }
    if (key.length > 128) {
      setErrorMsg("Account name is too long (max 128 characters).");
      return;
    }
    if (keys !== undefined && keys.includes(key)) {
      setErrorMsg("You already have an account with this name!");
      return;
    }
    // Untouched rows are skipped: fully empty ones, and the pre-added
    // password row when its value was left blank. Any other half-filled
    // row is an error.
    const rows = [];
    for (const d of details) {
      if (d.value === "" && (d.label === "" || d.label === "password")) {
        continue;
      }
      if (d.label === "" || d.value === "") {
        setErrorMsg("Each detail needs both a label and a value.");
        return;
      }
      if (d.label.length > 128) {
        setErrorMsg("Detail labels can be at most 128 characters.");
        return;
      }
      rows.push(d);
    }
    const labels = rows.map((d) => d.label);
    if (new Set(labels).size !== labels.length) {
      setErrorMsg("Detail labels must be unique.");
      return;
    }

    const fields = rows.map((d) => ({
      label: d.label,
      en_value: encryptPwWithKey(aesKey, d.value),
      sensitive: d.secret
    }));

    showLoader();
    setCreated(null);
    try {
      await apiCreateBucket(backend, auth, key, fields);
      addNewKey(key);
      const passwordRow = rows.find((d) => d.label === "password");
      setCreated({ key, password: passwordRow ? passwordRow.value : "" });
      setKey("");
      setKeyError("");
      setDetails([makePasswordRow()]);
      prefillPassword();
    } catch (e) {
      setErrorMsg("Encountered an error. Please try again.");
    } finally {
      hideLoader();
    }
  };

  const action = (
    <Button
      sx={primarySmallButtonSx}
      color="primary"
      variant="contained"
      size="small"
      onClick={handleClose}
    >
      Close
    </Button>
  );

  const anyLabelTooLong = details.some((d) => d.label.length > 128);

  return (
    <div className="Password-container">
      <div className="Password-header">Add a new account:</div>
      <TextField
        label="Account name"
        type="text"
        error={keyError !== ""}
        helperText={keyError}
        onChange={(e) => {
          const newKey = e.target.value;
          setKey(newKey);
          if (newKey.length > 128) {
            setKeyError("Account name is too long (max 128 characters).");
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
          marginBottom: "16px",
          ...textFieldSx
        }}
        InputLabelProps={inputLabelProps}
      />
      <div className="Detail-list">
        {details.map((d, i) => (
          <div className="Detail-form" key={i} data-testid={`new-detail-${i}`}>
            <div className="Detail-form-fields">
              <TextField
                size="small"
                label="label"
                value={d.label}
                error={d.label.length > 128}
                helperText={
                  d.label.length > 128
                    ? "Label is too long (max 128 characters)."
                    : ""
                }
                onChange={(e) => updateDetail(i, { label: e.target.value })}
                sx={{ ...textFieldSx, width: "150px" }}
                InputLabelProps={inputLabelProps}
              />
              <TextField
                size="small"
                label="value"
                value={d.value}
                onChange={(e) => updateDetail(i, { value: e.target.value })}
                onKeyPress={onKeyPress}
                sx={{ ...textFieldSx, flexGrow: 1 }}
                InputLabelProps={inputLabelProps}
              />
            </div>
            <div className="Detail-form-actions">
              <FormControlLabel
                control={
                  <Checkbox
                    checked={d.secret}
                    onChange={(e) =>
                      updateDetail(i, { secret: e.target.checked })
                    }
                    sx={checkboxSx}
                  />
                }
                label="secret"
                sx={checkboxLabelSx}
              />
              <span className="spacer" />
              <Button
                size="small"
                sx={secondaryButtonSx}
                onClick={() => generateInto(i)}
              >
                Generate
              </Button>
              <Tooltip title="Remove this detail">
                <IconButton
                  size="small"
                  aria-label="Remove"
                  sx={dangerIconButtonSx}
                  onClick={() => removeDetail(i)}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </div>
          </div>
        ))}
      </div>
      <Button
        sx={{ ...secondaryButtonSx, alignSelf: "flex-start", marginTop: "8px" }}
        onClick={addDetail}
      >
        + Add another detail
      </Button>
      <Button
        disabled={keyError !== "" || anyLabelTooLong}
        sx={{ ...primaryButtonSx, marginTop: "12px" }}
        type="button"
        onClick={submit}
      >
        Create account
      </Button>
      {created !== null &&
        (created.password !== "" ? (
          <CopyToClipboard
            onCopy={() => {
              setCopiedMsg(`Copied password for ${created.key}!`);
            }}
            text={created.password}
          >
            <Alert sx={{ ...copyBoxSx, marginTop: "16px" }} severity="info">
              <AlertTitle>Created {created.key}!</AlertTitle>
              Click here to copy the password.
            </Alert>
          </CopyToClipboard>
        ) : (
          <Alert
            sx={{ textAlign: "left", width: "100%", borderRadius: "8px", marginTop: "16px" }}
            severity="success"
          >
            <AlertTitle>Created {created.key}!</AlertTitle>
            This account was created without a password.
          </Alert>
        ))}
      <Snackbar
        open={copiedMsg !== null}
        autoHideDuration={5000}
        onClose={handleClose}
        message={copiedMsg ?? ""}
        action={action}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </div>
  );
}
