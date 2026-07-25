import { EXIT } from "../schema.ts";
import type { WardenDeps } from "../shared/deps.ts";
import { wardenFailure } from "../shared/errors.ts";
import { defaultWardenDeps } from "./deps.ts";
import { renderCommandHelp, renderWardenHelp } from "./help.ts";
import { COMMAND_REGISTRY, runWardenVersion } from "./registry.ts";

export type { RunDeps, WardenDeps } from "../shared/deps.ts";
export { wardenFailure } from "../shared/errors.ts";
export { gitResult, resolveMergeBase } from "../shared/git.ts";
export {
  type DetectionManifest,
  type DetectionPackage,
  detectWorkspace,
} from "./commands/detect.ts";
export { defaultDeps, defaultWardenDeps } from "./deps.ts";
export type { CommandDefinition, CommandFlag } from "./help.ts";
export {
  defaultManagerTerminal,
  type ManagerSelection,
  type ManagerTerminal,
  reduceManagerSelection,
  selectManagers,
} from "./managers.ts";
export { COMMAND_REGISTRY } from "./registry.ts";
export { runWnpm, runWnpx } from "./wnpm.ts";

export async function runWarden(
  argv: string[],
  deps: WardenDeps = defaultWardenDeps,
): Promise<number> {
  if (argv[0] === "--version" || argv[0] === "-v") return runWardenVersion(argv.slice(1), deps);
  if (!argv.length || argv[0] === "--help" || argv[0] === "help") {
    deps.stderr(renderWardenHelp(COMMAND_REGISTRY));
    return EXIT.allow;
  }
  const command = COMMAND_REGISTRY.find((candidate) => candidate.name === argv[0]);
  if (command) {
    if (argv.includes("--help")) {
      deps.stderr(renderCommandHelp(command));
      return EXIT.allow;
    }
    return command.run(argv.slice(1), deps);
  }
  return wardenFailure(
    deps,
    argv.includes("--json"),
    "usage",
    "WARDEN_UNKNOWN_VERB",
    `unknown verb "${argv[0]}"`,
    "run warden --help",
  );
}
