/**
 * Encode a string exactly like Go's encoding/json (HTML escaping on):
 * `<`, `>`, `&`, U+2028 and U+2029 become \u00XX escapes. Everything else is
 * what JSON.stringify produces (which matches Go for all other characters
 * we allow in messages).
 */
export function goString(s: string): string {
  if (!s.isWellFormed()) throw new Error("string is not valid UTF-16");
  return JSON.stringify(s).replace(
    /[<>&\u2028\u2029]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

export function goUint(n: number, what = "number"): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${what}: must be a non-negative safe integer`);
  return String(n);
}
