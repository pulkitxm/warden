import { expect, test } from "bun:test";
import {
  compilePolicy,
  DEFAULT_POLICY,
  resolvePolicy,
  type WardenPolicy,
} from "../../src/policy/compile.ts";
import type { PackageManager } from "../../src/shared/manager.ts";

const MANAGERS: PackageManager[] = ["npm", "pnpm", "yarn", "bun"];
const setting = (manager: PackageManager, policy: WardenPolicy | undefined, key: string) =>
  compilePolicy(manager, policy).settings.find((entry) => entry.key === key);

test("the default policy denies unapproved scripts and gates fresh releases", () => {
  expect(DEFAULT_POLICY).toEqual({
    scripts: "approved",
    minimumReleaseAgeDays: 1,
    exoticSources: "block",
    lockfile: "reverify",
    downgrades: "block",
  });
});

test("a partial policy inherits the rest of the defaults", () => {
  expect(resolvePolicy({ minimumReleaseAgeDays: 7 })).toMatchObject({
    minimumReleaseAgeDays: 7,
    scripts: "approved",
  });
  expect(resolvePolicy(undefined)).toEqual(DEFAULT_POLICY);
});

for (const manager of MANAGERS) {
  test(`${manager} compiles to a policy that names the manager it is for`, () => {
    expect(compilePolicy(manager, undefined).manager).toBe(manager);
  });

  test(`${manager} always states what warden enforces itself`, () => {
    const compiled = compilePolicy(manager, undefined);
    expect(compiled.enforcedByWarden.length).toBeGreaterThan(0);
    expect(compiled.enforcedByWarden.join(" ")).toContain("vetted before the install");
  });

  test(`${manager} suppresses dependency scripts under the default policy`, () => {
    const compiled = compilePolicy(manager, undefined);
    const keys = compiled.settings.map((entry) => entry.key);
    const scriptKey = keys.some((key) =>
      ["ignore-scripts", "allowBuilds", "enableScripts", "trustedDependencies"].includes(key),
    );
    expect(scriptKey).toBe(true);
  });

  test(`${manager} emits no script setting when scripts are explicitly allowed`, () => {
    const compiled = compilePolicy(manager, { scripts: "allow" });
    const keys = compiled.settings.map((entry) => entry.key);
    expect(
      keys.some((key) =>
        ["ignore-scripts", "allowBuilds", "enableScripts", "trustedDependencies"].includes(key),
      ),
    ).toBe(false);
  });

  test(`${manager} explains every intent it cannot express natively`, () => {
    for (const entry of compilePolicy(manager, undefined).unsupported) {
      expect(entry.reason.length).toBeGreaterThan(10);
      expect(entry.intent.length).toBeGreaterThan(5);
    }
  });
}

test("npm compiles the release age gate into minutes, which is the unit npm takes", () => {
  expect(setting("npm", { minimumReleaseAgeDays: 3 }, "minimum-release-age")?.value).toBe("4320");
});

test("npm blocks git and remote sources when exotic sources are blocked", () => {
  const keys = compilePolicy("npm", undefined).settings.map((entry) => entry.key);
  expect(keys).toContain("allow-git");
  expect(keys).toContain("allow-remote");
});

test("npm drops the source restrictions when exotic sources are allowed", () => {
  const keys = compilePolicy("npm", { exoticSources: "allow" }).settings.map((entry) => entry.key);
  expect(keys).not.toContain("allow-git");
});

test("npm admits it has no downgrade policy rather than pretending", () => {
  expect(compilePolicy("npm", undefined).unsupported.map((entry) => entry.intent)).toContain(
    "block version downgrades",
  );
});

test("pnpm uses strict dep builds so an unapproved build fails rather than being skipped", () => {
  expect(setting("pnpm", undefined, "strictDepBuilds")?.value).toBe("true");
  expect(setting("pnpm", undefined, "allowBuilds")?.value).toBe("[]");
});

test("pnpm expresses every part of the default policy natively", () => {
  const compiled = compilePolicy("pnpm", undefined);
  expect(compiled.unsupported).toEqual([]);
  expect(compiled.settings.map((entry) => entry.key)).toEqual([
    "strictDepBuilds",
    "allowBuilds",
    "minimumReleaseAge",
    "blockExoticSubdeps",
    "trustLockfile",
    "trustPolicy",
  ]);
});

test("pnpm drops the lockfile and downgrade settings when the policy relaxes them", () => {
  const keys = compilePolicy("pnpm", { lockfile: "trust", downgrades: "allow" }).settings.map(
    (entry) => entry.key,
  );
  expect(keys).not.toContain("trustLockfile");
  expect(keys).not.toContain("trustPolicy");
});

test("yarn turns on hardened mode to re-verify the lockfile", () => {
  expect(setting("yarn", undefined, "enableHardenedMode")?.value).toBe("true");
});

test("yarn records that warden itself blocks exotic sources", () => {
  const compiled = compilePolicy("yarn", undefined);
  expect(compiled.unsupported.map((entry) => entry.intent)).toContain("block git and url sources");
  expect(compiled.enforcedByWarden.join(" ")).toContain("blocked by the shim");
});

test("bun sets trustedDependencies and admits the rest is warden's job", () => {
  const compiled = compilePolicy("bun", undefined);
  expect(compiled.settings).toHaveLength(1);
  expect(compiled.settings[0]?.key).toBe("trustedDependencies");
  expect(compiled.unsupported).toHaveLength(4);
  expect(compiled.enforcedByWarden.join(" ")).toContain("younger than 1 day");
});

test("a policy with nothing enabled produces no settings and no false claims", () => {
  const compiled = compilePolicy("bun", {
    scripts: "allow",
    minimumReleaseAgeDays: 0,
    exoticSources: "allow",
    lockfile: "trust",
    downgrades: "allow",
  });
  expect(compiled.settings).toEqual([]);
  expect(compiled.unsupported).toEqual([]);
  expect(compiled.enforcedByWarden).toHaveLength(2);
});

test("every compiled setting names the file it belongs in and explains itself", () => {
  for (const manager of MANAGERS) {
    for (const entry of compilePolicy(manager, undefined).settings) {
      expect(entry.file).not.toBe("");
      expect(entry.note.length).toBeGreaterThan(10);
    }
  }
});
