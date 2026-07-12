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
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Snackbar from "@mui/material/Snackbar";
import Tooltip from "@mui/material/Tooltip";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import AddIcon from "@mui/icons-material/AddCircle";
import CopyToClipboard from "react-copy-to-clipboard";
import { KeyBinds } from "../util";
import "./account.css";

const textFieldSx = {
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
};

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  width: "100%",
  minHeight: "48px",
};

function FieldRow({ field, onSave, onDelete, onCopied, generate }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const startEdit = () => {
    setDraft(field.value);
    setEditing(true);
  };

  const save = () => {
    if (draft === "") {
      return;
    }
    setEditing(false);
    onSave(field.label, draft, field.sensitive);
  };

  if (editing) {
    return (
      <div style={rowStyle}>
        <span
          style={{ fontWeight: "bold", minWidth: "110px", textAlign: "left" }}
        >
          {field.label}
        </span>
        <TextField
          size="small"
          value={draft}
          autoFocus={true}
          onChange={(e) => setDraft(e.target.value)}
          onKeyPress={(e) => e.charCode === KeyBinds.ENTER && save()}
          sx={{ ...textFieldSx, flexGrow: 1 }}
        />
        <Tooltip title="Generate a new value">
          <IconButton onClick={async () => setDraft(await generate())}>
            <AutorenewIcon />
          </IconButton>
        </Tooltip>
        <IconButton aria-label={`save ${field.label}`} onClick={save}>
          <CheckIcon sx={{ color: "green" }} />
        </IconButton>
        <IconButton onClick={() => setEditing(false)}>
          <CloseIcon />
        </IconButton>
      </div>
    );
  }

  return (
    <div style={rowStyle}>
      <span
        style={{ fontWeight: "bold", minWidth: "110px", textAlign: "left" }}
      >
        {field.label}
      </span>
      <CopyToClipboard text={field.value} onCopy={onCopied}>
        <Tooltip title="Click to copy">
          <span
            style={{
              flexGrow: 1,
              textAlign: "left",
              cursor: "copy",
              overflowWrap: "anywhere",
            }}
          >
            {field.sensitive ? "••••••••••" : field.value}
          </span>
        </Tooltip>
      </CopyToClipboard>
      <CopyToClipboard text={field.value} onCopy={onCopied}>
        <IconButton aria-label={`copy ${field.label}`}>
          <ContentCopyIcon fontSize="small" />
        </IconButton>
      </CopyToClipboard>
      <IconButton aria-label={`edit ${field.label}`} onClick={startEdit}>
        <EditIcon fontSize="small" />
      </IconButton>
      <IconButton
        aria-label={`delete ${field.label}`}
        onClick={() => onDelete(field.label)}
      >
        <DeleteIcon fontSize="small" sx={{ ":hover": { color: "red" } }} />
      </IconButton>
    </div>
  );
}

function AddFieldForm({ existingLabels, onAdd, generate, setErrorMsg }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [labelError, setLabelError] = useState("");
  const [value, setValue] = useState("");
  const [sensitive, setSensitive] = useState(false);

  const add = () => {
    if (label === "" || value === "") {
      setErrorMsg("New fields need both a label and a value.");
      return;
    }
    if (label.length > 128) {
      setErrorMsg("Label is too long (max 128 characters).");
      return;
    }
    if (existingLabels.includes(label)) {
      setErrorMsg(`Field "${label}" already exists — edit it instead.`);
      return;
    }
    onAdd(label, value, sensitive);
    setLabel("");
    setLabelError("");
    setValue("");
    setSensitive(false);
    setOpen(false);
  };

  if (!open) {
    return (
      <Button
        startIcon={<AddIcon />}
        onClick={() => setOpen(true)}
        sx={{ color: "#3f50b5", fontWeight: "bold", marginTop: "8px" }}
      >
        Add field
      </Button>
    );
  }

  return (
    <div style={{ ...rowStyle, flexWrap: "wrap", marginTop: "8px" }}>
      <TextField
        size="small"
        label="label (e.g. email)"
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
        sx={{ ...textFieldSx, width: "160px" }}
      />
      <TextField
        size="small"
        label="value"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyPress={(e) => e.charCode === KeyBinds.ENTER && add()}
        sx={{ ...textFieldSx, flexGrow: 1 }}
      />
      <Tooltip title="Generate a new value">
        <IconButton onClick={async () => setValue(await generate())}>
          <AutorenewIcon />
        </IconButton>
      </Tooltip>
      <FormControlLabel
        control={
          <Checkbox
            checked={sensitive}
            onChange={(e) => setSensitive(e.target.checked)}
            sx={{ color: "black", "&.Mui-checked": { color: "#3f50b5" } }}
          />
        }
        label="secret"
      />
      <IconButton aria-label="save new field" disabled={labelError !== ""} onClick={add}>
        <CheckIcon sx={{ color: "green" }} />
      </IconButton>
      <IconButton aria-label="cancel new field" onClick={() => setOpen(false)}>
        <CloseIcon />
      </IconButton>
    </div>
  );
}

export default function BucketView({
  backend,
  auth,
  aesKey,
  bucketKey,
  onRenamed,
  onDeleted,
  setErrorMsg,
}) {
  const [fields, setFields] = useState(undefined);
  const [renaming, setRenaming] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    showLoader();
    try {
      const bucket = await apiGetBucket(backend, auth, bucketKey);
      setFields(
        bucket.fields.map((f) => ({
          label: f.label,
          value: decryptPwWithKey(aesKey, f.en_value),
          sensitive: f.sensitive,
        }))
      );
    } catch (e) {
      setErrorMsg("Unable to retrieve stored buckets at this time.");
    } finally {
      hideLoader();
    }
  }, [backend, auth, bucketKey, aesKey, setErrorMsg]);

  useEffect(() => {
    setFields(undefined);
    setRenaming(false);
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

  const saveField = (label, value, sensitive) =>
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

  const deleteField = (label) => {
    if (
      !window.confirm(
        `Delete field "${label}" from ${bucketKey}? This cannot be undone.`
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
      setErrorMsg("Bucket name is too long (max 128 characters).");
      return;
    }
    showLoader();
    try {
      await apiRenameBucket(backend, auth, bucketKey, keyDraft);
      setRenaming(false);
      onRenamed(bucketKey, keyDraft);
    } catch (e) {
      setErrorMsg("Unable to rename — does that name already exist?");
    } finally {
      hideLoader();
    }
  };

  const deleteBucket = async () => {
    if (
      !window.confirm(
        `Delete "${bucketKey}" and all of its fields? This cannot be undone.`
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

  if (fields === undefined) {
    return null;
  }

  return (
    <div style={{ width: "100%", marginTop: "12px" }}>
      <div style={rowStyle}>
        {renaming ? (
          <>
            <TextField
              size="small"
              value={keyDraft}
              autoFocus={true}
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyPress={(e) => e.charCode === KeyBinds.ENTER && rename()}
              sx={{ ...textFieldSx, flexGrow: 1 }}
            />
            <IconButton aria-label="save bucket name" onClick={rename}>
              <CheckIcon sx={{ color: "green" }} />
            </IconButton>
            <IconButton
              aria-label="cancel rename"
              onClick={() => setRenaming(false)}
            >
              <CloseIcon />
            </IconButton>
          </>
        ) : (
          <>
            <span
              style={{
                fontSize: "20px",
                fontWeight: "bold",
                flexGrow: 1,
                textAlign: "left",
              }}
            >
              {bucketKey}
            </span>
            <Tooltip title="Rename">
              <IconButton
                aria-label="rename bucket"
                onClick={() => {
                  setKeyDraft(bucketKey);
                  setRenaming(true);
                }}
              >
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete bucket">
              <IconButton aria-label="delete bucket" onClick={deleteBucket}>
                <DeleteIcon
                  fontSize="small"
                  sx={{ ":hover": { color: "red" } }}
                />
              </IconButton>
            </Tooltip>
          </>
        )}
      </div>
      {fields.map((f) => (
        <FieldRow
          key={f.label}
          field={f}
          onSave={saveField}
          onDelete={deleteField}
          onCopied={() => setCopied(true)}
          generate={generate}
        />
      ))}
      {fields.length === 0 && (
        <div style={{ textAlign: "left", opacity: 0.7 }}>
          This bucket is empty — add a field below.
        </div>
      )}
      <AddFieldForm
        existingLabels={fields.map((f) => f.label)}
        onAdd={saveField}
        generate={generate}
        setErrorMsg={setErrorMsg}
      />
      <Snackbar
        open={copied}
        autoHideDuration={3000}
        onClose={(e, reason) => reason !== "clickaway" && setCopied(false)}
        message="Copied!"
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </div>
  );
}
