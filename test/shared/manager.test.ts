import { expect, test } from "bun:test";
import { detectManager, installCommand, type ManagerFs } from "../../src/shared/manager.ts";

function fsWith(files: Record<string, string>, onPath: string[] = []): ManagerFs {
  return {
    readFile: (path) => {
      if (!(path in files)) throw new Error(`ENOENT ${path}`);
      return files[path] as string;
    },
    exists: (path) => path in files,
    which: (cmd) => (onPath.includes(cmd) ? `/usr/bin/${cmd}` : null),
  };
}

test("the invoked manager always wins, because the user typed it", () => {
  const fs = fsWith({ "/p/pnpm-lock.yaml": "" }, ["npm", "pnpm"]);
  const detection = detectManager(fs, "/p", "yarn");
  expect(detection.manager).toBe("yarn");
  expect(detection.source).toBe("invoked");
});

test("an unknown invoked name falls through instead of being trusted", () => {
  const fs = fsWith({ "/p/pnpm-lock.yaml": "" });
  expect(detectManager(fs, "/p", "make").manager).toBe("pnpm");
});

test("the packageManager field beats the lockfile", () => {
  const fs = fsWith({
    "/p/package.json": JSON.stringify({ packageManager: "yarn@4.1.0" }),
    "/p/pnpm-lock.yaml": "",
  });
  const detection = detectManager(fs, "/p");
  expect(detection.manager).toBe("yarn");
  expect(detection.source).toBe("packageManager");
  expect(detection.evidence).toContain("yarn@4.1.0");
});

const LOCKFILES: Array<[string, string]> = [
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
];

for (const [file, manager] of LOCKFILES) {
  test(`${file} selects ${manager}`, () => {
    const detection = detectManager(fsWith({ [`/p/${file}`]: "" }), "/p");
    expect(detection.manager).toBe(manager as never);
    expect(detection.source).toBe("lockfile");
  });
}

test("warden.config.json is consulted when there is no field and no lockfile", () => {
  const fs = fsWith({ "/p/warden.config.json": JSON.stringify({ packageManager: "pnpm" }) });
  const detection = detectManager(fs, "/p");
  expect(detection.manager).toBe("pnpm");
  expect(detection.source).toBe("config");
});

test("availability is the last resort, never a silent override", () => {
  const detection = detectManager(fsWith({}, ["pnpm"]), "/p");
  expect(detection.manager).toBe("pnpm");
  expect(detection.source).toBe("available");
});

test("with no signal at all the default is npm and says so", () => {
  const detection = detectManager(fsWith({}), "/p");
  expect(detection.manager).toBe("npm");
  expect(detection.source).toBe("default");
  expect(detection.evidence).toContain("defaulting");
});

test("a project that declares pnpm is never installed with npm just because npm exists", () => {
  const fs = fsWith({ "/p/pnpm-lock.yaml": "" }, ["npm"]);
  expect(detectManager(fs, "/p").manager).toBe("pnpm");
});

test("malformed manifests degrade instead of throwing", () => {
  expect(detectManager(fsWith({ "/p/package.json": "{not json" }), "/p").source).toBe("default");
  expect(detectManager(fsWith({ "/p/warden.config.json": "{not json" }), "/p").source).toBe(
    "default",
  );
  expect(detectManager(fsWith({ "/p/package.json": "{}" }), "/p").source).toBe("default");
});

test("an unknown packageManager value is ignored", () => {
  const fs = fsWith({ "/p/package.json": JSON.stringify({ packageManager: "cnpm@1" }) });
  expect(detectManager(fs, "/p").source).toBe("default");
});

test("install commands use each manager's own verb", () => {
  expect(installCommand("npm", ["lodash"], false)).toEqual(["npm", "install", "lodash"]);
  expect(installCommand("pnpm", ["lodash"], false)).toEqual(["pnpm", "add", "lodash"]);
  expect(installCommand("yarn", ["lodash"], false)).toEqual(["yarn", "add", "lodash"]);
  expect(installCommand("bun", ["lodash"], false)).toEqual(["bun", "add", "lodash"]);
});

test("an empty package list installs the manifest", () => {
  expect(installCommand("pnpm", [], false)).toEqual(["pnpm", "install"]);
  expect(installCommand("npm", [], false)).toEqual(["npm", "install"]);
});

test("script suppression uses the native flag where one exists", () => {
  expect(installCommand("npm", ["x"], true)).toContain("--ignore-scripts");
  expect(installCommand("pnpm", ["x"], true)).toContain("--ignore-scripts");
  expect(installCommand("yarn", ["x"], true)).not.toContain("--ignore-scripts");
  expect(installCommand("bun", ["x"], true)).not.toContain("--ignore-scripts");
});
