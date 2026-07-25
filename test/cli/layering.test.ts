import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../../src", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

const files = sourceFiles(src).map((path) => ({
  rel: relative(src, path).replaceAll("\\", "/"),
  text: readFileSync(path, "utf8"),
}));

const importsOf = (text: string) =>
  [...text.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] as string);

test("domain modules never import from the cli layer", () => {
  const offenders = files
    .filter((f) => !f.rel.startsWith("cli/") && !f.rel.startsWith("bin/"))
    .flatMap((f) =>
      importsOf(f.text)
        .filter((spec) => spec.includes("/cli/") || spec.startsWith("./cli/"))
        .map((spec) => `${f.rel} -> ${spec}`),
    );
  expect(offenders).toEqual([]);
});

test("shared modules depend only on shared, schema, and node builtins", () => {
  const offenders = files
    .filter((f) => f.rel.startsWith("shared/"))
    .flatMap((f) =>
      importsOf(f.text)
        .filter((spec) => spec.startsWith("."))
        .filter((spec) => !/^\.\/|^\.\.\/(schema|doctor)\.?/.test(spec) && !spec.includes("schema"))
        .filter((spec) => !spec.includes("doctor/index.ts"))
        .map((spec) => `${f.rel} -> ${spec}`),
    );
  expect(offenders).toEqual([]);
});

test("no cli module grows back into a god-file", () => {
  const oversized = files
    .filter((f) => f.rel.startsWith("cli/"))
    .map((f) => ({ rel: f.rel, lines: f.text.split("\n").length }))
    .filter((f) => f.lines > 300)
    .map((f) => `${f.rel} (${f.lines})`);
  expect(oversized).toEqual([]);
});

test("main.ts is a thin composition root, not an implementation", () => {
  const main = files.find((f) => f.rel === "cli/main.ts");
  expect(main).toBeDefined();
  expect(main?.text.split("\n").length).toBeLessThan(80);
});

test("every warden verb is implemented in its own command module", () => {
  const commands = readdirSync(join(src, "cli", "commands")).filter((f) => f.endsWith(".ts"));
  for (const verb of ["check", "ci", "config", "detect", "doctor", "fix", "init", "log", "schema"])
    expect(commands).toContain(`${verb}.ts`);
});
