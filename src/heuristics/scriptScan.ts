import { parse } from "@babel/parser";
import * as babelTraverse from "@babel/traverse";
import type { TarballFile } from "../types.js";

const traverse = ((babelTraverse as unknown as { default?: unknown }).default ??
  babelTraverse) as typeof import("@babel/traverse").default;

export interface ScanFinding {
  kind: "shell_exec" | "network" | "eval" | "base64" | "child_process" | "raw_ip" | "env_exfil";
  detail: string;
}

const RAW_IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/;

const SHELL_PATTERNS: Array<{ re: RegExp; kind: ScanFinding["kind"]; detail: string }> = [
  { re: /\bcurl\b/, kind: "network", detail: "invokes curl" },
  { re: /\bwget\b/, kind: "network", detail: "invokes wget" },
  {
    re: /\|\s*(sh|bash|node)\b/,
    kind: "shell_exec",
    detail: "pipes downloaded content into a shell/node",
  },
  { re: /\bnode\s+-e\b/, kind: "eval", detail: "runs inline node code (node -e)" },
  { re: /\beval\b/, kind: "eval", detail: "uses eval" },
  { re: /base64\s+(-d|--decode)/, kind: "base64", detail: "decodes base64 on the command line" },
  { re: /\b(nc|ncat|netcat)\b/, kind: "network", detail: "invokes netcat" },
  { re: /\/dev\/tcp\//, kind: "network", detail: "uses /dev/tcp network redirection" },
];

export function scanShellScript(body: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const { re, kind, detail } of SHELL_PATTERNS) {
    if (re.test(body)) findings.push({ kind, detail });
  }
  if (RAW_IPV4.test(body)) {
    findings.push({ kind: "raw_ip", detail: "references a raw IP address" });
  }
  return findings;
}

const NETWORK_MODULES = new Set(["http", "https", "net", "dgram", "tls", "http2"]);
const EXEC_MODULES = new Set(["child_process", "node:child_process"]);

function moduleName(node: unknown): string | undefined {
  const arg = (node as { arguments?: Array<{ value?: unknown; type?: string }> })?.arguments?.[0];
  if (arg && arg.type === "StringLiteral" && typeof arg.value === "string") {
    return arg.value;
  }
  return undefined;
}

export function scanJsSource(code: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const seen = new Set<string>();
  const add = (f: ScanFinding) => {
    const key = `${f.kind}:${f.detail}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push(f);
    }
  };

  try {
    const ast = parse(code, {
      sourceType: "unambiguous",
      errorRecovery: true,
      plugins: ["typescript", "jsx"],
    });
    traverse(ast, {
      CallExpression(path) {
        const callee = path.node.callee;
        if (callee.type === "Identifier" && callee.name === "eval") {
          add({ kind: "eval", detail: "calls eval()" });
        }
        if (callee.type === "Identifier" && callee.name === "require") {
          const mod = moduleName(path.node);
          if (mod && EXEC_MODULES.has(mod)) {
            add({ kind: "child_process", detail: "requires child_process" });
          }
          if (mod && NETWORK_MODULES.has(mod.replace(/^node:/, ""))) {
            add({ kind: "network", detail: `requires ${mod}` });
          }
        }
        if (callee.type === "Identifier" && callee.name === "fetch") {
          add({ kind: "network", detail: "calls fetch()" });
        }
        if (
          callee.type === "MemberExpression" &&
          callee.object.type === "Identifier" &&
          callee.object.name === "Buffer" &&
          callee.property.type === "Identifier" &&
          callee.property.name === "from"
        ) {
          const enc = path.node.arguments[1];
          if (enc && enc.type === "StringLiteral" && enc.value === "base64") {
            add({ kind: "base64", detail: "decodes a base64 buffer" });
          }
        }
      },
      NewExpression(path) {
        const callee = path.node.callee;
        if (callee.type === "Identifier" && callee.name === "Function") {
          add({ kind: "eval", detail: "constructs code via new Function()" });
        }
      },
      ImportDeclaration(path) {
        const src = path.node.source.value;
        if (EXEC_MODULES.has(src)) {
          add({ kind: "child_process", detail: "imports child_process" });
        }
        if (NETWORK_MODULES.has(src.replace(/^node:/, ""))) {
          add({ kind: "network", detail: `imports ${src}` });
        }
      },
      MemberExpression(path) {
        if (
          path.node.object.type === "Identifier" &&
          path.node.object.name === "process" &&
          path.node.property.type === "Identifier" &&
          path.node.property.name === "env"
        ) {
          add({ kind: "env_exfil", detail: "reads process.env" });
        }
      },
      StringLiteral(path) {
        if (RAW_IPV4.test(path.node.value)) {
          add({ kind: "raw_ip", detail: "contains a raw IP address literal" });
        }
      },
    });
  } catch {
    return scanJsWithRegex(code);
  }

  return findings;
}

export function scanJsWithRegex(code: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  if (/\beval\s*\(/.test(code)) findings.push({ kind: "eval", detail: "calls eval()" });
  if (/new\s+Function\s*\(/.test(code))
    findings.push({ kind: "eval", detail: "constructs code via new Function()" });
  if (/require\(\s*['"]child_process['"]\s*\)/.test(code))
    findings.push({ kind: "child_process", detail: "requires child_process" });
  if (/\bfetch\s*\(/.test(code)) findings.push({ kind: "network", detail: "calls fetch()" });
  if (/Buffer\.from\([^)]*['"]base64['"]/.test(code))
    findings.push({ kind: "base64", detail: "decodes a base64 buffer" });
  if (RAW_IPV4.test(code))
    findings.push({ kind: "raw_ip", detail: "contains a raw IP address literal" });
  return findings;
}

export function scanFiles(files: TarballFile[]): ScanFinding[] {
  const all: ScanFinding[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    if (!f.content || f.binary) continue;
    if (!/\.(js|cjs|mjs|jsx|ts|cts|mts|tsx)$/i.test(f.path)) continue;
    for (const finding of scanJsSource(f.content)) {
      const key = `${finding.kind}:${finding.detail}`;
      if (!seen.has(key)) {
        seen.add(key);
        all.push(finding);
      }
    }
  }
  return all;
}
