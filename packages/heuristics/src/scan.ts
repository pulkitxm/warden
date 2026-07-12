/**
 * Content scanners for lifecycle-script bodies (shell) and JS source (AST).
 *
 * Ported from the prototype's Babel scanner, re-implemented on acorn +
 * acorn-walk (Bun's Transpiler only does import scanning, not a walkable AST).
 * Both scanners are pure and return findings; the rules layer turns findings
 * into weighted Signals.
 */

import * as acorn from "acorn";
import * as walk from "acorn-walk";

export type FindingKind =
  | "shell_exec"
  | "network"
  | "eval"
  | "base64"
  | "child_process"
  | "raw_ip"
  | "env_exfil";

export interface Finding {
  kind: FindingKind;
  detail: string;
}

const RAW_IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/;

const SHELL_PATTERNS: Array<{ re: RegExp; kind: FindingKind; detail: string }> = [
  { re: /\bcurl\b/, kind: "network", detail: "invokes curl" },
  { re: /\bwget\b/, kind: "network", detail: "invokes wget" },
  { re: /\|\s*(sh|bash|node)\b/, kind: "shell_exec", detail: "pipes downloaded content into a shell/node" },
  { re: /\bnode\s+-e\b/, kind: "eval", detail: "runs inline node code (node -e)" },
  { re: /\beval\b/, kind: "eval", detail: "uses eval" },
  { re: /base64\s+(-d|--decode)/, kind: "base64", detail: "decodes base64 on the command line" },
  { re: /\b(nc|ncat|netcat)\b/, kind: "network", detail: "invokes netcat" },
  { re: /\/dev\/tcp\//, kind: "network", detail: "uses /dev/tcp network redirection" },
];

/** Scan a shell / lifecycle-script body. */
export function scanShell(body: string): Finding[] {
  const out: Finding[] = [];
  for (const { re, kind, detail } of SHELL_PATTERNS) if (re.test(body)) out.push({ kind, detail });
  if (RAW_IPV4.test(body)) out.push({ kind: "raw_ip", detail: "references a raw IP address" });
  return out;
}

const NETWORK_MODULES = new Set(["http", "https", "net", "dgram", "tls", "http2"]);
const EXEC_MODULES = new Set(["child_process"]);

function moduleArg(node: any): string | undefined {
  const a = node?.arguments?.[0];
  return a && a.type === "Literal" && typeof a.value === "string" ? a.value : undefined;
}

/** AST-scan JS source; regex fallback if it won't parse. */
export function scanJs(code: string): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  const add = (f: Finding) => {
    const k = `${f.kind}:${f.detail}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(f);
    }
  };

  let ast: acorn.Node;
  try {
    ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "module", allowReturnOutsideFunction: true });
  } catch {
    try {
      ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true });
    } catch {
      return scanRegex(code);
    }
  }

  walk.simple(ast, {
    CallExpression(node: any) {
      const c = node.callee;
      if (c.type === "Identifier" && c.name === "eval") add({ kind: "eval", detail: "calls eval()" });
      if (c.type === "Identifier" && c.name === "require") {
        const mod = moduleArg(node)?.replace(/^node:/, "");
        if (mod && EXEC_MODULES.has(mod)) add({ kind: "child_process", detail: "requires child_process" });
        if (mod && NETWORK_MODULES.has(mod)) add({ kind: "network", detail: `requires ${mod}` });
      }
      if (c.type === "Identifier" && c.name === "fetch") add({ kind: "network", detail: "calls fetch()" });
      if (
        c.type === "MemberExpression" &&
        c.object?.type === "Identifier" &&
        c.object.name === "Buffer" &&
        c.property?.name === "from" &&
        node.arguments?.[1]?.type === "Literal" &&
        node.arguments[1].value === "base64"
      ) {
        add({ kind: "base64", detail: "decodes a base64 buffer" });
      }
    },
    NewExpression(node: any) {
      if (node.callee?.type === "Identifier" && node.callee.name === "Function") {
        add({ kind: "eval", detail: "constructs code via new Function()" });
      }
    },
    ImportDeclaration(node: any) {
      const src = String(node.source?.value ?? "").replace(/^node:/, "");
      if (EXEC_MODULES.has(src)) add({ kind: "child_process", detail: "imports child_process" });
      if (NETWORK_MODULES.has(src)) add({ kind: "network", detail: `imports ${src}` });
    },
    MemberExpression(node: any) {
      if (node.object?.type === "Identifier" && node.object.name === "process" && node.property?.name === "env") {
        add({ kind: "env_exfil", detail: "reads process.env" });
      }
    },
    Literal(node: any) {
      if (typeof node.value === "string" && RAW_IPV4.test(node.value)) {
        add({ kind: "raw_ip", detail: "contains a raw IP address literal" });
      }
    },
  });
  return out;
}

function scanRegex(code: string): Finding[] {
  const out: Finding[] = [];
  if (/\beval\s*\(/.test(code)) out.push({ kind: "eval", detail: "calls eval()" });
  if (/new\s+Function\s*\(/.test(code)) out.push({ kind: "eval", detail: "constructs code via new Function()" });
  if (/require\(\s*['"]child_process['"]\s*\)/.test(code)) out.push({ kind: "child_process", detail: "requires child_process" });
  if (/\bfetch\s*\(/.test(code)) out.push({ kind: "network", detail: "calls fetch()" });
  if (/Buffer\.from\([^)]*['"]base64['"]/.test(code)) out.push({ kind: "base64", detail: "decodes a base64 buffer" });
  if (RAW_IPV4.test(code)) out.push({ kind: "raw_ip", detail: "contains a raw IP address literal" });
  return out;
}

/** Shannon entropy (bits/char) over the first N chars. */
export function entropy(s: string, cap = 20_000): number {
  const slice = s.slice(0, cap);
  if (!slice.length) return 0;
  const freq = new Map<string, number>();
  for (const ch of slice) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of freq.values()) {
    const p = c / slice.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Obfuscation score 0..1 for a source string. */
export function obfuscationScore(content: string): { score: number; reason: string } {
  const lines = content.split("\n");
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  const avg = content.length / Math.max(1, lines.length);
  let score = 0;
  const reasons: string[] = [];
  if (longest > 2000) {
    score += 0.4;
    reasons.push(`line of ${longest} chars`);
  } else if (avg > 400) {
    score += 0.25;
    reasons.push("very long average line length");
  }
  if (/[A-Za-z0-9+/]{200,}={0,2}/.test(content)) {
    score += 0.35;
    reasons.push("large encoded blob");
  }
  if (/(\\x[0-9a-fA-F]{2}){20,}/.test(content)) {
    score += 0.35;
    reasons.push("long hex-escape sequence");
  }
  if (/\b_0x[0-9a-f]{4,}\b/.test(content)) {
    score += 0.3;
    reasons.push("hex-identifier obfuscation (_0x…)");
  }
  if (entropy(content) > 5.2 && longest > 500) {
    score += 0.2;
    reasons.push("high entropy");
  }
  return { score: Math.min(1, score), reason: reasons.join(", ") };
}
