import { describe, expect, it } from "bun:test";
import { parseCommand } from "../src/adapters/parseCommand.js";

describe("parseCommand", () => {
  it("parses npm install with packages and flags", () => {
    expect(parseCommand("npm install -D left-pad chalk")).toEqual({
      kind: "install",
      packages: ["left-pad", "chalk"],
    });
  });

  it("parses npm i shorthand", () => {
    expect(parseCommand("npm i express")).toEqual({
      kind: "install",
      packages: ["express"],
    });
  });

  it("parses pnpm add and yarn add", () => {
    expect(parseCommand("pnpm add -w foo bar")).toEqual({
      kind: "install",
      packages: ["foo", "bar"],
    });
    expect(parseCommand("yarn add react")).toEqual({ kind: "install", packages: ["react"] });
  });

  it("parses npx with version and ignores the package's own args", () => {
    expect(parseCommand("npx some-cli@latest --port 3000")).toEqual({
      kind: "exec",
      packages: ["some-cli@latest"],
    });
  });

  it("parses bunx and pnpm dlx", () => {
    expect(parseCommand("bunx cowsay hello")).toEqual({ kind: "exec", packages: ["cowsay"] });
    expect(parseCommand("pnpm dlx create-vite my-app")).toEqual({
      kind: "exec",
      packages: ["create-vite"],
    });
  });

  it("handles compound commands (cd x && npm install foo)", () => {
    expect(parseCommand("cd app && npm install is0dd")).toEqual({
      kind: "install",
      packages: ["is0dd"],
    });
  });

  it("handles scoped package names", () => {
    expect(parseCommand("npm i @scope/pkg@1.2.3")).toEqual({
      kind: "install",
      packages: ["@scope/pkg@1.2.3"],
    });
  });

  it("returns null for non-install commands", () => {
    expect(parseCommand("ls -la")).toBeNull();
    expect(parseCommand("git commit -m 'x'")).toBeNull();
    expect(parseCommand("node build.js")).toBeNull();
  });

  it("returns empty packages for a bare install (known gap)", () => {
    expect(parseCommand("npm install")).toEqual({ kind: "install", packages: [] });
  });

  it("deduplicates across segments", () => {
    expect(parseCommand("npm i foo && npm i foo bar")).toEqual({
      kind: "install",
      packages: ["foo", "bar"],
    });
  });
});

describe("parseCommand — wrapper prefixes (hook bypass fix)", () => {
  it("sees through env-var assignment prefixes", () => {
    expect(parseCommand("NODE_OPTIONS= npm i evil-pkg")).toEqual({
      kind: "install",
      packages: ["evil-pkg"],
    });
    expect(parseCommand("FORCE_COLOR=1 CI=true npx evil-cli")).toEqual({
      kind: "exec",
      packages: ["evil-cli"],
    });
  });

  it("sees through sudo, env and other wrappers, including their flags", () => {
    expect(parseCommand("sudo npm i evil-pkg")).toEqual({
      kind: "install",
      packages: ["evil-pkg"],
    });
    expect(parseCommand("sudo -E npm i evil-pkg")).toEqual({
      kind: "install",
      packages: ["evil-pkg"],
    });
    expect(parseCommand("env -i PATH=/bin npm i evil-pkg")).toEqual({
      kind: "install",
      packages: ["evil-pkg"],
    });
    expect(parseCommand("nohup nice npx evil-cli")).toEqual({
      kind: "exec",
      packages: ["evil-cli"],
    });
  });

  it("still ignores unrelated commands and bare assignments", () => {
    expect(parseCommand("FOO=bar")).toBeNull();
    expect(parseCommand("sudo rm -rf /tmp/x")).toBeNull();
    expect(parseCommand("ls -la")).toBeNull();
  });

  it("skips env assignments in install and exec argument positions", () => {
    expect(parseCommand("npm i evil-pkg REGISTRY=http://e")).toEqual({
      kind: "install",
      packages: ["evil-pkg"],
    });
    expect(parseCommand("npx FOO=1 some-cli")).toEqual({ kind: "exec", packages: ["some-cli"] });
  });

  it("parses yarn dlx and flags before the dlx package", () => {
    expect(parseCommand("yarn dlx --quiet create-app")).toEqual({
      kind: "exec",
      packages: ["create-app"],
    });
    expect(parseCommand("pnpm dlx")).toBeNull();
  });

  it("returns null for npx with no package", () => {
    expect(parseCommand("npx --yes")).toBeNull();
  });

  it("keeps npm alias specs intact for the engine to unwrap", () => {
    expect(parseCommand("npm i safe-name@npm:evil-pkg@1.0.0")).toEqual({
      kind: "install",
      packages: ["safe-name@npm:evil-pkg@1.0.0"],
    });
  });

  it("marks mixed exec+install compounds as exec", () => {
    expect(parseCommand("npx create-app my && npm i left-pad")).toEqual({
      kind: "exec",
      packages: ["create-app", "left-pad"],
    });
    expect(parseCommand("npm i left-pad && npx create-app my")).toEqual({
      kind: "exec",
      packages: ["left-pad", "create-app"],
    });
  });
});
