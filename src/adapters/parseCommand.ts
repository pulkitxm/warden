export type CommandKind = "install" | "exec";

export interface ParsedCommand {
  kind: CommandKind;
  packages: string[];
}

const INSTALL_VERBS = new Set(["install", "i", "add"]);
const PM_INSTALL = new Set(["npm", "pnpm", "yarn", "bun"]);
const EXEC_COMMANDS = new Set(["npx", "bunx"]);
const WRAPPERS = new Set(["sudo", "env", "command", "nice", "nohup", "time"]);
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

function splitSegments(command: string): string[] {
  return command
    .split(/&&|\|\||;|\|/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function tokenize(segment: string): string[] {
  const raw = segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return raw.map((t) => t.replace(/^['"]|['"]$/g, ""));
}

function stripWrappers(tokens: string[]): string[] {
  let i = 0;
  let sawWrapper = false;
  while (i < tokens.length) {
    const t = tokens[i];
    if (ENV_ASSIGNMENT.test(t)) {
      i++;
      sawWrapper = true;
      continue;
    }
    if (WRAPPERS.has(t)) {
      i++;
      sawWrapper = true;
      continue;
    }
    if (sawWrapper && t.startsWith("-")) {
      i++;
      continue;
    }
    break;
  }
  return tokens.slice(i);
}

function isFlag(tok: string): boolean {
  return tok.startsWith("-");
}

function parseDlx(tokens: string[]): string | null {
  if ((tokens[0] === "pnpm" || tokens[0] === "yarn") && tokens[1] === "dlx") {
    const pkg = tokens.slice(2).find((t) => !isFlag(t));
    return pkg ?? null;
  }
  return null;
}

function parseSegment(segment: string): ParsedCommand | null {
  const tokens = stripWrappers(tokenize(segment));
  if (!tokens.length) return null;

  if (EXEC_COMMANDS.has(tokens[0])) {
    const pkg = tokens.slice(1).find((t) => !isFlag(t) && !ENV_ASSIGNMENT.test(t));
    return pkg ? { kind: "exec", packages: [pkg] } : null;
  }

  const dlx = parseDlx(tokens);
  if (dlx) return { kind: "exec", packages: [dlx] };

  if (PM_INSTALL.has(tokens[0]) && INSTALL_VERBS.has(tokens[1] ?? "")) {
    const rest = tokens.slice(2).filter((t) => !isFlag(t) && !ENV_ASSIGNMENT.test(t));
    return { kind: "install", packages: rest };
  }

  return null;
}

export function parseCommand(command: string): ParsedCommand | null {
  const segments = splitSegments(command);
  let kind: CommandKind | null = null;
  const packages: string[] = [];
  for (const seg of segments) {
    const parsed = parseSegment(seg);
    if (!parsed) continue;
    kind = kind === "exec" ? "exec" : parsed.kind;
    packages.push(...parsed.packages);
  }
  if (kind === null) return null;
  return { kind, packages: [...new Set(packages)] };
}
