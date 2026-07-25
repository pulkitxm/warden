let enabled = process.stderr.isTTY && !process.env.NO_COLOR;

export function setColor(on: boolean): void {
  enabled = on;
}

export const c = (code: string, s: string) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = (s: string) => c("1", s);
export const dim = (s: string) => c("2", s);
