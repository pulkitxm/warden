import { COMMAND_REGISTRY } from "../src/cli/registry.ts";

const reference = COMMAND_REGISTRY.filter((command) => !command.hidden).map((command) => ({
  name: command.name,
  description: command.description,
  positional: command.positional ?? null,
  flags: command.flags.map((flag) => ({
    name: flag.name,
    description: flag.description,
    valueHint: flag.valueHint ?? null,
  })),
  exitCodes: command.exitCodes,
  example: command.example,
}));

const target = new URL("../web/src/lib/commands.json", import.meta.url);
await Bun.write(target, `${JSON.stringify(reference, null, 2)}\n`);
process.stderr.write(`wrote ${reference.length} commands to web/src/lib/commands.json\n`);
