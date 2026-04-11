import { evaluatePasswordStrength } from "./passwordStrength";

describe("evaluatePasswordStrength", () => {
  // ── Weak passwords ─────────────────────────────────────────────────────

  test("empty string is weak", () => {
    expect(evaluatePasswordStrength("")).toBe("weak");
  });

  test("short password is weak", () => {
    expect(evaluatePasswordStrength("Ab1!")).toBe("weak");
  });

  test("common password is weak regardless of length", () => {
    expect(evaluatePasswordStrength("password")).toBe("weak");
    expect(evaluatePasswordStrength("Password")).toBe("weak");
    expect(evaluatePasswordStrength("12345678")).toBe("weak");
    expect(evaluatePasswordStrength("qwertyuiop")).toBe("weak");
  });

  test("repeated characters are weak", () => {
    expect(evaluatePasswordStrength("aaaaaaaaaa")).toBe("weak");
    expect(evaluatePasswordStrength("AAAAAAAAA")).toBe("weak");
  });

  test("sequential runs are weak", () => {
    expect(evaluatePasswordStrength("abcdefgh")).toBe("weak");
    expect(evaluatePasswordStrength("87654321")).toBe("weak");
  });

  test("single character class (lowercase only, 8+ chars) is weak", () => {
    expect(evaluatePasswordStrength("abcjklmn")).toBe("weak");
  });

  // ── Fair passwords ─────────────────────────────────────────────────────

  test("two character classes at 8+ chars is fair", () => {
    expect(evaluatePasswordStrength("Helloabc")).toBe("fair");
    expect(evaluatePasswordStrength("mypword1")).toBe("fair");
    expect(evaluatePasswordStrength("mypword!")).toBe("fair");
  });

  test("three character classes at 8+ chars is fair", () => {
    expect(evaluatePasswordStrength("Abcdefg1")).toBe("fair");
  });

  // ── Strong passwords ───────────────────────────────────────────────────

  test("four character classes at 8+ chars is strong", () => {
    expect(evaluatePasswordStrength("Abcdef1!")).toBe("strong");
  });

  test("three classes with 16+ chars is strong", () => {
    expect(evaluatePasswordStrength("Abcdefghijklmn1x")).toBe("strong");
  });

  test("long password with all classes is strong", () => {
    expect(evaluatePasswordStrength("MyP@ssw0rd!Is#Very&Long")).toBe("strong");
  });

  // ── Edge cases ─────────────────────────────────────────────────────────

  test("null/undefined returns weak", () => {
    expect(evaluatePasswordStrength(null)).toBe("weak");
    expect(evaluatePasswordStrength(undefined)).toBe("weak");
  });

  test("exactly 8 characters with two classes is fair", () => {
    expect(evaluatePasswordStrength("Helloabc")).toBe("fair");
  });

  test("exactly 7 characters is weak even with all classes", () => {
    expect(evaluatePasswordStrength("Ab1!xyz")).toBe("weak");
  });
});
