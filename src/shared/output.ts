export type Verbosity = "quiet" | "normal" | "verbose";

let level: Verbosity = "normal";

export function setVerbosity(next: Verbosity): void {
  level = next;
}

export function verbosity(): Verbosity {
  return level;
}

export function isQuiet(): boolean {
  return level === "quiet";
}

export function isVerbose(): boolean {
  return level === "verbose";
}
