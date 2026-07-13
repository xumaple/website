// Shared design system for everything that renders on the white card
// (.App-container). The MUI theme is dark mode, so these constants force
// dark-on-white colors in one place instead of per-component sx blobs.
//
// Button hierarchy:
//   - primaryButtonSx    : the one main action of a screen (contained, indigo)
//   - secondaryButtonSx  : supporting actions (indigo text button)
//   - dangerButtonSx     : destructive actions (red text button)

export const ACCENT = "#3f50b5";
export const INK = "#282c34";
export const DANGER = "#d32f2f";

export const textFieldSx = {
  fieldset: { borderColor: "black" },
  input: { color: "black" },
  label: { color: "black" },
  "& .MuiOutlinedInput-root": {
    "&.Mui-focused fieldset": {
      borderColor: ACCENT,
    },
  },
  "&:hover fieldset": {
    borderColor: `${ACCENT} !important`,
  },
};

export const inputLabelProps = {
  sx: { "&.Mui-focused": { color: ACCENT } },
};

export const primaryButtonSx = {
  width: "100%",
  height: "45px",
  borderRadius: "8px",
  backgroundColor: ACCENT,
  color: "white",
  fontWeight: "bold",
  ":hover": { backgroundColor: INK },
  "&.Mui-disabled": {
    backgroundColor: "rgba(63, 80, 181, 0.35)",
    color: "white",
  },
};

// Small contained primary, used as the snackbar "Close" action.
export const primarySmallButtonSx = {
  color: "white",
  backgroundColor: ACCENT,
  borderRadius: "4px",
  ":hover": { backgroundColor: INK },
};

export const secondaryButtonSx = {
  color: ACCENT,
  fontWeight: "bold",
  minWidth: 0,
  padding: "4px 10px",
  whiteSpace: "nowrap",
  ":hover": { backgroundColor: "rgba(63, 80, 181, 0.08)" },
};

export const dangerButtonSx = {
  color: DANGER,
  fontWeight: "bold",
  minWidth: 0,
  padding: "4px 10px",
  whiteSpace: "nowrap",
  ":hover": { backgroundColor: "rgba(211, 47, 47, 0.08)" },
};

// Icon buttons carry the same secondary/danger colors as the text buttons so
// symbols stay clearly visible on the white card. Always pair them with an
// aria-label and a Tooltip.
export const iconButtonSx = {
  color: ACCENT,
  padding: "5px",
  ":hover": { backgroundColor: "rgba(63, 80, 181, 0.08)" },
};

export const dangerIconButtonSx = {
  color: DANGER,
  padding: "5px",
  ":hover": { backgroundColor: "rgba(211, 47, 47, 0.08)" },
};

export const checkboxSx = {
  color: "black",
  "&.Mui-checked": { color: ACCENT },
};

export const checkboxLabelSx = {
  color: "black",
  marginRight: 0,
  "& .MuiFormControlLabel-label": { fontSize: "14px" },
};

export const selectedChipSx = {
  backgroundColor: ACCENT,
  color: "white",
  fontWeight: "bold",
  fontSize: "13px",
  ":hover": { backgroundColor: INK },
  "&:focus": { backgroundColor: ACCENT },
};

export const unselectedChipSx = {
  backgroundColor: "white",
  color: "black",
  border: "1px solid rgba(0, 0, 0, 0.4)",
  fontSize: "13px",
  ":hover": { backgroundColor: "#e8eaf6" },
};

// The dark click-to-copy box; radius and padding match the card language.
export const copyBoxSx = {
  textAlign: "left",
  width: "100%",
  borderRadius: "8px",
  padding: "10px 16px",
  ":hover": {
    backgroundColor: "black",
    cursor: "copy",
  },
};
