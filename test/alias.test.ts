import { describe, expect, it } from "bun:test";
import { rewriteArgv } from "../src/cli/alias.js";

describe("rewriteArgv", () => {
  it("prepends the command and strips a leading verb", () => {
    expect(rewriteArgv(["install", "left-pad"], "install", ["install", "i", "add"])).toEqual([
      "install",
      "left-pad",
    ]);
    expect(rewriteArgv(["i", "-D", "chalk"], "install", ["install", "i", "add"])).toEqual([
      "install",
      "-D",
      "chalk",
    ]);
    expect(rewriteArgv(["left-pad"], "install", ["install", "i", "add"])).toEqual([
      "install",
      "left-pad",
    ]);
  });

  it("handles bnpx-style rewrites and empty argv", () => {
    expect(rewriteArgv(["npx", "cowsay"], "npx", ["npx"])).toEqual(["npx", "cowsay"]);
    expect(rewriteArgv(["cowsay", "--json"], "npx", ["npx"])).toEqual(["npx", "cowsay", "--json"]);
    expect(rewriteArgv([], "npx", ["npx"])).toEqual(["npx"]);
    expect(rewriteArgv([], "install")).toEqual(["install"]);
  });
});
