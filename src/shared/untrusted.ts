const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, "g");
const ZERO_WIDTH = /[\u200B-\u200F\u2060-\u2064\uFEFF]/g;
const BIDI = /[\u202A-\u202E\u2066-\u2069]/g;

export const UNTRUSTED_MAX = 400;

function stripControl(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? " " : ch;
  }
  return out;
}

export function sanitizeUntrusted(value: string, max = UNTRUSTED_MAX): string {
  const cleaned = stripControl(value.replace(ANSI, "").replace(ZERO_WIDTH, "").replace(BIDI, ""))
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1)}\u2026`;
}

export function quarantine(
  fields: Record<string, string | undefined | null>,
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== "string") continue;
    const cleaned = sanitizeUntrusted(value);
    if (cleaned) out[key] = cleaned;
  }
  return Object.keys(out).length ? out : undefined;
}
