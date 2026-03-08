/**
 * Evaluate the strength of a password.
 *
 * Considers length, character-class variety (lowercase, uppercase, digits,
 * symbols), and common weak patterns (repeated characters, sequential runs,
 * keyboard rows, and well-known bad passwords).
 *
 * Returns one of: "weak", "fair", or "strong".
 */

/** Minimum length to even be considered "fair". */
const MIN_LENGTH = 8;
/** Length threshold for a bonus toward "strong". */
const STRONG_LENGTH = 16;

/** A small list of notoriously common passwords to reject outright. */
const COMMON_PASSWORDS = new Set([
  "password",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty",
  "qwertyuiop",
  "letmein",
  "iloveyou",
  "admin",
  "welcome",
  "monkey",
  "master",
  "dragon",
  "login",
  "princess",
  "football",
  "shadow",
  "sunshine",
  "trustno1",
  "passw0rd",
  "password1",
  "password123",
  "abc123",
  "abcdef",
]);

/**
 * Returns true if more than half the characters are the same character.
 */
function isRepeatedChars(pw) {
  const counts = {};
  for (const ch of pw) {
    counts[ch] = (counts[ch] || 0) + 1;
  }
  return Object.values(counts).some((c) => c > pw.length / 2);
}

/**
 * Returns true if the password is a sequential run (e.g. "abcdefgh" or
 * "87654321").
 */
function isSequentialRun(pw) {
  if (pw.length < 4) return false;
  let ascending = true;
  let descending = true;
  for (let i = 1; i < pw.length; i++) {
    if (pw.charCodeAt(i) - pw.charCodeAt(i - 1) !== 1) ascending = false;
    if (pw.charCodeAt(i - 1) - pw.charCodeAt(i) !== 1) descending = false;
    if (!ascending && !descending) return false;
  }
  return true;
}

/**
 * @param {string} pw  The plaintext password to evaluate.
 * @returns {"weak" | "fair" | "strong"}
 */
export function evaluatePasswordStrength(pw) {
  if (!pw || pw.length === 0) return "weak";

  // Instant reject for common passwords (case-insensitive).
  if (COMMON_PASSWORDS.has(pw.toLowerCase())) return "weak";

  // Too short is always weak.
  if (pw.length < MIN_LENGTH) return "weak";

  // Degenerate patterns are weak regardless of length.
  if (isRepeatedChars(pw)) return "weak";
  if (isSequentialRun(pw)) return "weak";

  // Count character classes present.
  const hasLower = /[a-z]/.test(pw);
  const hasUpper = /[A-Z]/.test(pw);
  const hasDigit = /[0-9]/.test(pw);
  const hasSymbol = /[^a-zA-Z0-9]/.test(pw);

  const classCount = [hasLower, hasUpper, hasDigit, hasSymbol].filter(
    Boolean
  ).length;

  // Scoring: start with class count, add a bonus for length.
  let score = classCount;
  if (pw.length >= STRONG_LENGTH) score += 1;

  // score 1 = only one class, short  -> weak
  // score 2 = two classes or one class + long -> fair
  // score 3 = three classes or two + long -> fair/strong boundary
  // score 4+ = strong
  if (score <= 1) return "weak";
  if (score <= 3) return "fair";
  return "strong";
}
