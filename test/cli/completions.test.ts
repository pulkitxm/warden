import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMMAND_REGISTRY,
  defaultWardenDeps,
  runWarden,
  type WardenDeps,
} from "../../src/cli/main.ts";

async function generated(shell: "bash" | "zsh" | "fish") {
  const out: string[] = [];
  const deps: WardenDeps = {
    ...defaultWardenDeps,
    home: "/home/test",
    stdout: (value) => out.push(value),
  };
  expect(await runWarden(["completions", shell], deps)).toBe(0);
  return out.join("");
}

test("registry verbs drive root help and every completion script", async () => {
  const err: string[] = [];
  const deps: WardenDeps = {
    ...defaultWardenDeps,
    home: "/home/test",
    stderr: (value) => err.push(value),
  };
  expect(await runWarden(["--help"], deps)).toBe(0);
  const help = err.join("");
  const scripts = await Promise.all([generated("bash"), generated("zsh"), generated("fish")]);
  for (const command of COMMAND_REGISTRY) {
    if (command.hidden) {
      expect(help).not.toContain(command.name);
      for (const script of scripts) expect(script).not.toContain(command.name);
    } else {
      expect(help).toContain(command.name);
      for (const script of scripts) expect(script).toContain(command.name);
    }
  }
});

test("bash completions define verb, flag, and shell completion", async () => {
  const script = await generated("bash");
  expect(script).toContain("COMP_CWORD == 1");
  expect(script).toContain("complete -F _warden warden");
  expect(script).toContain("bash zsh fish --help");
  expect(script).toContain("--reporter --base --help");
});

test("zsh completions define verb, flag, and shell completion", async () => {
  const script = await generated("zsh");
  expect(script).toContain("_describe 'verb' verbs");
  expect(script).toContain("compdef _warden warden");
  expect(script).toContain("_values 'shell' 'bash' 'zsh' 'fish'");
  expect(script).toContain("'--allow-risky:permit blocked packages and exit 10'");
});

test("fish completions define verb, flag, and shell completion", async () => {
  const script = await generated("fish");
  expect(script).toContain("complete -c warden -f");
  expect(script).toContain("__fish_seen_subcommand_from check");
  expect(script).toContain("-l 'allow-risky'");
  expect(script).toContain("-a 'bash zsh fish'");
});

test("unknown completion shells return a typed error", async () => {
  const out: string[] = [];
  const deps: WardenDeps = {
    ...defaultWardenDeps,
    home: "/home/test",
    stdout: (value) => out.push(value),
  };
  expect(await runWarden(["completions", "powershell"], deps)).toBe(30);
  expect(JSON.parse(out.join("")).error).toEqual({
    kind: "usage",
    code: "WARDEN_UNKNOWN_SHELL",
    reason: 'unknown completion shell "powershell"',
    hint: "run warden completions --help",
  });
});

for (const shell of ["bash", "zsh"] as const) {
  test.skipIf(!Bun.which(shell))(`${shell} accepts its generated completion script`, async () => {
    const root = mkdtempSync(join(tmpdir(), `warden-${shell}-completion-`));
    try {
      const path = join(root, `completion.${shell}`);
      writeFileSync(path, await generated(shell));
      expect(Bun.spawnSync([shell, "-n", path]).exitCode).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
