import { EXIT } from "../../schema.ts";
import { AGENT_NAMES } from "../../shared/agents.ts";
import type { WardenDeps } from "../../shared/deps.ts";
import { wardenFailure } from "../../shared/errors.ts";

interface UserConfig {
  mode: "verbose" | "brief" | "block" | "log";
  intercept: { install: boolean; exec: boolean };
  agent?: { name: string };
}

const initialConfig = (): UserConfig => ({
  mode: "brief",
  intercept: { install: true, exec: true },
});

export function configPath(deps: WardenDeps): string {
  return `${deps.home}/.warden/config.json`;
}

function readConfig(deps: WardenDeps): UserConfig {
  let raw: string;
  try {
    raw = deps.readFile(configPath(deps));
  } catch {
    return initialConfig();
  }
  const value = JSON.parse(raw) as Partial<UserConfig>;
  const modes = ["verbose", "brief", "block", "log"];
  if (
    !modes.includes(value.mode ?? "") ||
    typeof value.intercept?.install !== "boolean" ||
    typeof value.intercept.exec !== "boolean"
  ) {
    throw new Error("invalid user config");
  }
  return value as UserConfig;
}

function writeConfig(deps: WardenDeps, config: UserConfig): void {
  deps.mkdir(`${deps.home}/.warden`);
  deps.writeFile(configPath(deps), `${JSON.stringify(config, null, 2)}\n`);
}

export function runWardenConfig(argv: string[], deps: WardenDeps): number {
  const wantsJson = argv.includes("--json");
  try {
    const args = argv.filter((arg) => arg !== "--json");
    const config = readConfig(deps);
    if (!args.length) {
      if (wantsJson) deps.stdout(`${JSON.stringify(config)}\n`);
      else deps.stderr(`${JSON.stringify(config, null, 2)}\n`);
      return EXIT.allow;
    }
    if (args[0] === "mode" && args.length === 2) {
      if (!["verbose", "brief", "block", "log"].includes(args[1]!)) {
        throw new Error(`invalid mode "${args[1]}"`);
      }
      config.mode = args[1] as UserConfig["mode"];
      writeConfig(deps, config);
      deps.stderr(`reporting mode set to ${config.mode}\n`);
      return EXIT.allow;
    }
    if (args[0] === "intercept") {
      const scope = args.length === 3 ? args[1] : "all";
      const state = args.length === 3 ? args[2] : args[1];
      if (
        !state ||
        !["on", "off"].includes(state) ||
        !["all", "install", "exec"].includes(scope!)
      ) {
        throw new Error("invalid intercept setting");
      }
      const enabled = state === "on";
      if (scope === "all" || scope === "install") config.intercept.install = enabled;
      if (scope === "all" || scope === "exec") config.intercept.exec = enabled;
      writeConfig(deps, config);
      deps.stderr(
        scope === "all"
          ? `interception ${enabled ? "enabled (install, exec)" : "disabled; shims now pass every command straight through"}\n`
          : `${scope} interception ${enabled ? "enabled" : "disabled"}\n`,
      );
      return EXIT.allow;
    }
    if (args[0] === "agent" && args.length === 2) {
      if (!AGENT_NAMES.includes(args[1]!)) {
        throw new Error(`unknown agent "${args[1]}"; known agents: ${AGENT_NAMES.join(", ")}`);
      }
      config.agent = { name: args[1]! };
      writeConfig(deps, config);
      deps.stderr(`agent set to ${config.agent.name}\n`);
      return EXIT.allow;
    }
    throw new Error("invalid config command");
  } catch (error) {
    return wardenFailure(
      deps,
      wantsJson,
      "config",
      "WARDEN_CONFIG_ERROR",
      (error as Error).message,
      "run warden config --help",
    );
  }
}

export function runWardenUninstall(argv: string[], deps: WardenDeps): number {
  if (argv.length) {
    return wardenFailure(
      deps,
      false,
      "usage",
      "WARDEN_UNINSTALL_ARGUMENTS",
      "uninstall does not accept arguments",
      "run warden uninstall --help",
    );
  }
  const installer = `${deps.home}/.warden/install.sh`;
  if (!deps.exists(installer)) {
    return wardenFailure(
      deps,
      false,
      "config",
      "WARDEN_INSTALLER_NOT_FOUND",
      `installer not found at ${installer}`,
      "reinstall Warden, then run warden uninstall",
    );
  }
  return deps.spawn(["sh", installer, "--uninstall"]) === 0 ? EXIT.allow : EXIT.error;
}
