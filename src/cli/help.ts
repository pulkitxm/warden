import type { WardenDeps } from "../shared/deps.ts";

export interface CommandFlag {
  name: `--${string}`;
  description: string;
  valueHint?: string;
}

export interface CommandDefinition {
  name: string;
  description: string;
  learnMore?: string;
  flags: readonly CommandFlag[];
  positional?: { kind: string; values?: readonly string[] };
  exitCodes: string;
  example: string;
  hidden?: boolean;
  run: (argv: string[], deps: WardenDeps) => number | Promise<number>;
}

export const DOCS_BASE = "https://warden.pulkit.page/docs";

const visible = (commands: readonly CommandDefinition[]) =>
  commands.filter((command) => !command.hidden);

export const helpFlag = { name: "--help", description: "show this help" } as const;

export function renderWardenHelp(commands: readonly CommandDefinition[]): string {
  const width = Math.max(...visible(commands).map((command) => command.name.length));
  const rows = visible(commands)
    .map((command) => `  ${command.name.padEnd(width)}  ${command.description}`)
    .join("\n");
  return `warden: vets packages and enforces repo policy before code runs\n\nusage: warden <verb> [flags]\n\n${rows}\n\nglobal flags: --json  --no-color  --quiet  --verbose  -h  -v\n\nexit codes: 0 allow · 10 warn · 20 block · 30 error\ndocs: https://warden.pulkit.page/docs\n`;
}

export function renderCommandHelp(command: CommandDefinition): string {
  const usageFlags = command.flags
    .map((flag) => `[${flag.name}${flag.valueHint ? ` ${flag.valueHint}` : ""}]`)
    .join(" ");
  const usage = ["usage: warden", command.name, command.positional?.kind, usageFlags]
    .filter(Boolean)
    .join(" ");
  const width = Math.max(
    ...command.flags.map((flag) => flag.name.length + (flag.valueHint?.length ?? -1) + 1),
  );
  const flags = command.flags
    .map((flag) => {
      const label = `${flag.name}${flag.valueHint ? ` ${flag.valueHint}` : ""}`;
      return `  ${label.padEnd(width)}  ${flag.description}`;
    })
    .join("\n");
  const learnMore = `${DOCS_BASE}/${command.learnMore ?? `cli/${command.name}`}`;
  return `warden ${command.name}: ${command.description}\n\n${usage}\n\n${flags}\n\nexit codes: ${command.exitCodes}\nexample: ${command.example}\nlearn more: ${learnMore}\n`;
}

const WNPM_COMPLETIONS = [
  { name: "install", flags: ["--json", "--allow-risky"] },
  { name: "doctor", flags: ["--dir", "--json", "--no-apply", "--no-verify"] },
] as const;

export function bashCompletions(commands: readonly CommandDefinition[]): string {
  const verbs = visible(commands)
    .map((command) => command.name)
    .join(" ");
  const cases = visible(commands)
    .map((command) => {
      const flags = command.flags.map((flag) => flag.name).join(" ");
      const values = command.positional?.values?.join(" ");
      return values
        ? `    ${command.name})\n      if (( COMP_CWORD == 2 )); then COMPREPLY=( $(compgen -W '${values} ${flags}' -- "$cur") ); else COMPREPLY=( $(compgen -W '${flags}' -- "$cur") ); fi\n      ;;`
        : `    ${command.name}) COMPREPLY=( $(compgen -W '${flags}' -- "$cur") ) ;;`;
    })
    .join("\n");
  const wnpmVerbs = WNPM_COMPLETIONS.map((command) => command.name).join(" ");
  const wnpmCases = WNPM_COMPLETIONS.map(
    (command) =>
      `    ${command.name}) COMPREPLY=( $(compgen -W '${command.flags.join(" ")}' -- "$cur") ) ;;`,
  ).join("\n");
  return `_warden() {\n  local cur\n  COMPREPLY=()\n  cur="\${COMP_WORDS[COMP_CWORD]}"\n  if (( COMP_CWORD == 1 )); then\n    COMPREPLY=( $(compgen -W '${verbs}' -- "$cur") )\n    return\n  fi\n  case "\${COMP_WORDS[1]}" in\n${cases}\n  esac\n}\ncomplete -F _warden warden\n\n_wnpm() {\n  local cur\n  COMPREPLY=()\n  cur="\${COMP_WORDS[COMP_CWORD]}"\n  if (( COMP_CWORD == 1 )); then\n    COMPREPLY=( $(compgen -W '${wnpmVerbs}' -- "$cur") )\n    return\n  fi\n  case "\${COMP_WORDS[1]}" in\n${wnpmCases}\n  esac\n}\ncomplete -F _wnpm wnpm\n`;
}

function zshQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function zshCompletions(commands: readonly CommandDefinition[]): string {
  const verbs = visible(commands)
    .map((command) => `    ${zshQuote(`${command.name}:${command.description}`)}`)
    .join("\n");
  const cases = visible(commands)
    .map((command) => {
      const flags = command.flags
        .map((flag) => zshQuote(`${flag.name}:${flag.description}`))
        .join(" ");
      const values = command.positional?.values?.map(zshQuote).join(" ");
      return values
        ? `    ${command.name})\n      if (( CURRENT == 3 )); then _values 'shell' ${values} ${flags}; else _values 'flag' ${flags}; fi\n      ;;`
        : `    ${command.name}) _values 'flag' ${flags} ;;`;
    })
    .join("\n");
  const wnpmVerbs = WNPM_COMPLETIONS.map((command) => `    ${zshQuote(command.name)}`).join("\n");
  const wnpmCases = WNPM_COMPLETIONS.map(
    (command) => `    ${command.name}) _values 'flag' ${command.flags.map(zshQuote).join(" ")} ;;`,
  ).join("\n");
  return `_warden() {\n  local -a verbs\n  verbs=(\n${verbs}\n  )\n  if (( CURRENT == 2 )); then\n    _describe 'verb' verbs\n    return\n  fi\n  case "$words[2]" in\n${cases}\n  esac\n}\nif (( ! $+functions[compdef] )); then\n  autoload -Uz compinit\n  compinit -u\nfi\ncompdef _warden warden\n\n_wnpm() {\n  local -a verbs\n  verbs=(\n${wnpmVerbs}\n  )\n  if (( CURRENT == 2 )); then\n    _describe 'verb' verbs\n    return\n  fi\n  case "$words[2]" in\n${wnpmCases}\n  esac\n}\ncompdef _wnpm wnpm\n`;
}

function fishQuote(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

export function fishCompletions(commands: readonly CommandDefinition[]): string {
  const verbs = visible(commands).map(
    (command) =>
      `complete -c warden -n 'test (count (commandline -opc)) -eq 1' -a ${fishQuote(command.name)} -d ${fishQuote(command.description)}`,
  );
  const details = visible(commands).flatMap((command) => {
    const flags = command.flags.map(
      (flag) =>
        `complete -c warden -n '__fish_seen_subcommand_from ${command.name}' -l ${fishQuote(flag.name.slice(2))} -d ${fishQuote(flag.description)}`,
    );
    const values = command.positional?.values;
    if (values)
      flags.push(
        `complete -c warden -n '__fish_seen_subcommand_from ${command.name}; and test (count (commandline -opc)) -eq 2' -a ${fishQuote(values.join(" "))}`,
      );
    return flags;
  });
  const wnpmVerbs = WNPM_COMPLETIONS.map(
    (command) =>
      `complete -c wnpm -n 'test (count (commandline -opc)) -eq 1' -a ${fishQuote(command.name)}`,
  );
  const wnpmFlags = WNPM_COMPLETIONS.flatMap((command) =>
    command.flags.map(
      (flag) =>
        `complete -c wnpm -n '__fish_seen_subcommand_from ${command.name}' -l ${fishQuote(flag.slice(2))}`,
    ),
  );
  return `${[`complete -c warden -f`, ...verbs, ...details, `complete -c wnpm -f`, ...wnpmVerbs, ...wnpmFlags].join("\n")}\n`;
}
