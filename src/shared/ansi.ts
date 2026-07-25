const color = process.stderr.isTTY && !process.env.NO_COLOR;

export const c = (code: string, s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = (s: string) => c("1", s);
export const dim = (s: string) => c("2", s);
