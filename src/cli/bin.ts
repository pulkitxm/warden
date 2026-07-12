import { run } from "./main.js";

export function runAndExit(argv: string[]): void {
  run(argv)
    .then((code) => process.exit(code))
    .catch((e) => {
      process.stderr.write(`warden: ${(e as Error).message}\n`);
      process.exit(2);
    });
}
