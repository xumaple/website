import { useState, useEffect, useCallback } from "react";
import { showLoader, hideLoader } from "../loader/loader";
import { encryptPwWithKey, decryptPwWithKey } from "../crypto/encrypt";
import {
  apiGetBucket,
  apiUpsertField,
  apiDeleteField,
  apiRenameBucket,
  apiDeleteBucket,
  apiNewPassword,
} from "../api";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Divider from "@mui/material/Divider";
import EditIcon from "@mui/icons-material/Edit";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import CopyToClipboard from "react-copy-to-clipboard";
import { KeyBinds } from "../util";
import {
  textFieldSx,
  inputLabelProps,
  primarySmallButtonSx,
  secondaryButtonSx,
  dangerButtonSx,
  iconButtonSx,
  dangerIconButtonSx,
  checkboxSx,
  checkboxLabelSx,
  selectedChipSx,
  unselectedChipSx,
  copyBoxSx,
} from "./styles";
import "./account.css";

const MASKED_VALUE = "••••••••";

function DetailRow({ detail, onSave, onDelete, generate }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const startEdit = () => {
    setDraft(detail.value);
    setEditing(true);
  };

  const save = () => {
    if (draft === "") {
      return;
    }
    setEditing(false);
    onSave(detail.label, draft, detail.sensitive);
  };

  if (editing) {
    return (
      <div className="Detail-form" data-testid={`detail-row-${detail.label}`}>
        <div className="Detail-form-fields">
          <span className="Detail-label">{detail.label}</span>
          <TextField
            size="small"
            value={draft}
            autoFocus={true}
            onChange={(e) => setDraft(e.target.value)}
            onKeyPress={(e) => e.charCode === KeyBinds.ENTER && save()}
            sx={{ ...textFieldSx, flexGrow: 1 }}
          />
        </div>
        <div className="Detail-form-actions">
          <span className="spacer" />
          <Button
            size="small"
            sx={secondaryButtonSx}
            onClick={async () => setDraft(await generate())}
          >
            Generate
          </Button>
          <Button
            size="small"
            sx={secondaryButtonSx}
            disabled={draft === ""}
            onClick={save}
          >
            Save
          </Button>
          <Tooltip title="Cancel">
            <IconButton
              size="small"
              aria-label="Cancel"
              sx={iconButtonSx}
              onClick={() => setEditing(false)}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </div>
      </div>
    );
  }

  return (
    <div className="Detail-row" data-testid={`detail-row-${detail.label}`}>
      <span className="Detail-label">{detail.label}</span>
      <span className="Detail-value">
        {detail.sensitive ? MASKED_VALUE : detail.value}
      </span>
      <Tooltip title={`Edit ${detail.label}`}>
        <IconButton
          size="small"
          aria-label="Edit"
          sx={iconButtonSx}
          onClick={startEdit}
        >
          <EditIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title={`Delete ${detail.label}`}>
        <IconButton
          size="small"
          aria-label="Delete"
          sx={dangerIconButtonSx}
          onClick={() => onDelete(detail.label)}
        >
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </div>
  );
}

function AddDetailForm({ existingLabels, onAdd, generate, setErrorMsg }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [labelError, setLabelError] = useState("");
  const [value, setValue] = useState("");
  const [secret, setSecret] = useState(false);

  const add = () => {
    if (label === "" || value === "") {
      setErrorMsg("New details need both a label and a value.");
      return;
    }
    if (label.length > 128) {
      setErrorMsg("Label is too long (max 128 characters).");
      return;
    }
    if (existingLabels.includes(label)) {
      setErrorMsg(`Detail "${label}" already exists — edit it instead.`);
      return;
    }
    onAdd(label, value, secret);
    setLabel("");
    setLabelError("");
    setValue("");
    setSecret(false);
    setOpen(false);
  };

  if (!open) {
    return (
      <Button
        sx={{ ...secondaryButtonSx, alignSelf: "flex-start" }}
        onClick={() => setOpen(true)}
      >
        + Add a detail
      </Button>
    );
  }

  return (
    <div className="Detail-form">
      <div className="Detail-form-fields">
        <TextField
          size="small"
          label="label"
          value={label}
          autoFocus={true}
          error={labelError !== ""}
          helperText={labelError}
          onChange={(e) => {
            const newLabel = e.target.value;
            setLabel(newLabel);
            if (newLabel.length > 128) {
              setLabelError("Label is too long (max 128 characters).");
            } else {
              setLabelError("");
            }
          }}
          sx={{ ...textFieldSx, width: "150px" }}
          InputLabelProps={inputLabelProps}
        />
        <TextField
          size="small"
          label="value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyPress={(e) => e.charCode === KeyBinds.ENTER && add()}
          sx={{ ...textFieldSx, flexGrow: 1 }}
          InputLabelProps={inputLabelProps}
        />
      </div>
      <div className="Detail-form-actions">
        <FormControlLabel
          control={
            <Checkbox
              checked={secret}
              onChange={(e) => setSecret(e.target.checked)}
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
          onClick={async () => setValue(await generate())}
        >
          Generate
        </Button>
        <Button
          size="small"
          sx={secondaryButtonSx}
          disabled={labelError !== ""}
          onClick={add}
        >
          Add
        </Button>
        <Tooltip title="Cancel">
          <IconButton
            size="small"
            aria-label="Cancel"
            sx={iconButtonSx}
            onClick={() => setOpen(false)}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
}

export default function AccountView({
  backend,
  auth,
  aesKey,
  bucketKey,
  onRenamed,
  onDeleted,
  setErrorMsg,
}) {
  const [details, setDetails] = useState(undefined);
  const [selected, setSelected] = useState(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [copiedMsg, setCopiedMsg] = useState(null);

  const refresh = useCallback(async () => {
    showLoader();
    try {
      const bucket = await apiGetBucket(backend, auth, bucketKey);
      setDetails(
        bucket.fields.map((f) => ({
          label: f.label,
          value: decryptPwWithKey(aesKey, f.en_value),
          sensitive: f.sensitive,
        }))
      );
    } catch (e) {
      setErrorMsg("Unable to retrieve this account at this time.");
    } finally {
      hideLoader();
    }
  }, [backend, auth, bucketKey, aesKey, setErrorMsg]);

  // The component is keyed on the selection, so switching accounts remounts
  // it with fresh state. Mid-life this effect re-runs only when the account
  // is renamed (bucketKey changes); panel state — the open management
  // section, the selected chip — intentionally survives a rename.
  useEffect(() => {
    refresh();
  }, [refresh]);

  const mutate = async (action) => {
    showLoader();
    try {
      await action();
      await refresh();
    } catch (e) {
      setErrorMsg("Encountered an error. Please try again.");
    } finally {
      hideLoader();
    }
  };

  const saveDetail = (label, value, sensitive) =>
    mutate(() =>
      apiUpsertField(
        backend,
        auth,
        bucketKey,
        label,
        encryptPwWithKey(aesKey, value),
        sensitive
      )
    );

  const deleteDetail = (label) => {
    if (
      !window.confirm(
        `Delete the "${label}" detail from ${bucketKey}? This cannot be undone.`
      )
    ) {
      return;
    }
    mutate(() => apiDeleteField(backend, auth, bucketKey, label));
  };

  const rename = async () => {
    if (keyDraft === "" || keyDraft === bucketKey) {
      setRenaming(false);
      return;
    }
    if (keyDraft.length > 128) {
      setErrorMsg("Account name is too long (max 128 characters).");
      return;
    }
    showLoader();
    try {
      await apiRenameBucket(backend, auth, bucketKey, keyDraft);
      setRenaming(false);
      onRenamed(bucketKey, keyDraft);
    } catch (e) {
      setErrorMsg("Unable to rename — does that account name already exist?");
    } finally {
      hideLoader();
    }
  };

  const deleteAccount = async () => {
    if (
      !window.confirm(
        `Delete "${bucketKey}" and all of its details? This cannot be undone.`
      )
    ) {
      return;
    }
    showLoader();
    try {
      await apiDeleteBucket(backend, auth, bucketKey);
      onDeleted(bucketKey);
    } catch (e) {
      setErrorMsg("Encountered an error. Please try again.");
    } finally {
      hideLoader();
    }
  };

  const generate = async () => {
    try {
      return await apiNewPassword(backend);
    } catch (e) {
      setErrorMsg("Encountered an error. Please try again.");
      return "";
    }
  };

  if (details === undefined) {
    return null;
  }

  // The copy box shows the chip the user clicked; before any click it shows
  // the password detail, falling back to the first detail.
  const shown =
    details.find((d) => d.label === selected) ??
    details.find((d) => d.label === "password") ??
    details[0] ??
    null;

  const snackbarAction = (
    <Button
      sx={primarySmallButtonSx}
      color="primary"
      variant="contained"
      size="small"
      onClick={() => setCopiedMsg(null)}
    >
      Close
    </Button>
  );

  return (
    <div className="Account-view">
      <div className="Chip-row">
        {details.map((d) => (
          <Chip
            key={d.label}
            label={d.label}
            onClick={() => setSelected(d.label)}
            sx={d.label === shown?.label ? selectedChipSx : unselectedChipSx}
          />
        ))}
      </div>
      {details.length === 0 && (
        <div style={{ fontSize: "15px", color: "black" }}>
          This account has no details yet — use "Manage this account" below to
          add some.
        </div>
      )}
      {shown !== null && (
        <CopyToClipboard
          text={shown.value}
          onCopy={() => setCopiedMsg(`Copied ${shown.label} for ${bucketKey}!`)}
        >
          <Alert sx={copyBoxSx} severity="info">
            <AlertTitle>
              Retrieved {shown.label} for {bucketKey}!
            </AlertTitle>
            {!shown.sensitive && (
              <div style={{ fontWeight: "bold", overflowWrap: "anywhere" }}>
                {shown.value}
              </div>
            )}
            Click here to copy.
          </Alert>
        </CopyToClipboard>
      )}
      <Button
        sx={secondaryButtonSx}
        onClick={() => setManageOpen(!manageOpen)}
        endIcon={manageOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
      >
        Manage this account
      </Button>
      {manageOpen && (
        <div className="Manage-panel">
          {details.map((d) => (
            <DetailRow
              key={d.label}
              detail={d}
              onSave={saveDetail}
              onDelete={deleteDetail}
              generate={generate}
            />
          ))}
          <AddDetailForm
            existingLabels={details.map((d) => d.label)}
            onAdd={saveDetail}
            generate={generate}
            setErrorMsg={setErrorMsg}
          />
          <Divider sx={{ borderColor: "rgba(0, 0, 0, 0.2)" }} />
          {renaming ? (
            <div className="Detail-row">
              <TextField
                size="small"
                label="New account name"
                value={keyDraft}
                autoFocus={true}
                onChange={(e) => setKeyDraft(e.target.value)}
                onKeyPress={(e) => e.charCode === KeyBinds.ENTER && rename()}
                sx={{ ...textFieldSx, flexGrow: 1 }}
                InputLabelProps={inputLabelProps}
              />
              <Button size="small" sx={secondaryButtonSx} onClick={rename}>
                Save
              </Button>
              <Tooltip title="Cancel">
                <IconButton
                  size="small"
                  aria-label="Cancel"
                  sx={iconButtonSx}
                  onClick={() => setRenaming(false)}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </div>
          ) : (
            <div className="Detail-row" style={{ justifyContent: "flex-end" }}>
              <Button
                size="small"
                sx={secondaryButtonSx}
                onClick={() => {
                  setKeyDraft(bucketKey);
                  setRenaming(true);
                }}
              >
                Rename account
              </Button>
              <Button size="small" sx={dangerButtonSx} onClick={deleteAccount}>
                Delete account
              </Button>
            </div>
          )}
        </div>
      )}
      <Snackbar
        open={copiedMsg !== null}
        autoHideDuration={5000}
        onClose={(e, reason) => reason !== "clickaway" && setCopiedMsg(null)}
        message={copiedMsg ?? ""}
        action={snackbarAction}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </div>
  );
}
