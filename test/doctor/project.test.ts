import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultProjectFs,
  installedVersion,
  loadProject,
  type ProjectFs,
} from "../../src/doctor/project.ts";

const doctorProject = fileURLToPath(new URL("../../fixtures/doctor-project", import.meta.url));

function memFs(files: Record<string, string>): ProjectFs {
  return {
    readFile: (path) => {
      const hit = files[path];
      if (hit === undefined) throw new Error(`ENOENT: ${path}`);
      return hit;
    },
    exists: (path) => files[path] !== undefined,
  };
}

test("loadProject reads the fixture demo project through the real filesystem", () => {
  const project = loadProject(doctorProject);
  expect(project.name).toBe("doctor-demo");
  expect(project.packageManager).toBe("npm");
  expect(project.scripts.test).toContain("require");
  expect(project.deps.map((d) => `${d.name}@${d.installed}`)).toEqual([
    "acme-http@1.0.0",
    "acme-json@2.1.0",
    "left-pad@1.3.0",
  ]);
  expect(project.deps.every((d) => d.group === "prod")).toBe(true);
});

test("loadProject collects dev dependencies and defaults missing fields", () => {
  const fs = memFs({
    [join("/p", "package.json")]: JSON.stringify({
      devDependencies: { "dev-tool": "^2.0.0" },
    }),
  });
  const project = loadProject("/p", fs);
  expect(project.name).toBe("project");
  expect(project.scripts).toEqual({});
  expect(project.deps).toEqual([
    { name: "dev-tool", range: "^2.0.0", group: "dev", installed: undefined },
  ]);
});

test("loadProject detects bun via bun.lock or bun.lockb", () => {
  const base = { [join("/p", "package.json")]: "{}" };
  expect(loadProject("/p", memFs({ ...base, [join("/p", "bun.lock")]: "" })).packageManager).toBe(
    "bun",
  );
  expect(loadProject("/p", memFs({ ...base, [join("/p", "bun.lockb")]: "" })).packageManager).toBe(
    "bun",
  );
  expect(loadProject("/p", memFs(base)).packageManager).toBe("npm");
});

test("installedVersion falls back from lockfile to node_modules to undefined", () => {
  const v1Lock = memFs({
    [join("/p", "package-lock.json")]: JSON.stringify({
      dependencies: { lib: { version: "3.1.4" } },
    }),
  });
  expect(installedVersion("/p", "lib", v1Lock)).toBe("3.1.4");

  const fromModules = memFs({
    [join("/p", "node_modules", "lib", "package.json")]: JSON.stringify({ version: "1.1.1" }),
  });
  expect(installedVersion("/p", "lib", fromModules)).toBe("1.1.1");

  expect(installedVersion("/p", "lib", memFs({}))).toBeUndefined();
});

test("defaultProjectFs reads real files and checks existence", () => {
  const dir = mkdtempSync(join(tmpdir(), "wnpm-project-"));
  mkdirSync(join(dir, "node_modules", "real-lib"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "real-lib", "package.json"), '{"version":"9.9.9"}');
  expect(defaultProjectFs.exists(join(dir, "node_modules"))).toBe(true);
  expect(defaultProjectFs.exists(join(dir, "nope"))).toBe(false);
  expect(installedVersion(dir, "real-lib")).toBe("9.9.9");
});
