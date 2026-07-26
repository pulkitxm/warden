import type { VerdictLevel } from "../../schema.ts";
import type { ClaimKind, ClaimStatus } from "../types.ts";
import type { FileChange } from "./diff.ts";

export interface RecordedClaim {
  claim: string;
  kind: ClaimKind;
  keywords: string[];
  sourceText: string;
}

export interface RecordedMatch {
  claim_id: string;
  hunk_ids: string[];
  status: ClaimStatus;
}

export interface CorpusExpectation {
  verdict: VerdictLevel;
  claims: ClaimStatus[] | "unpinned";
  scopeCreep: boolean;
  hallucinations: number;
}

export interface CorpusCase {
  id: string;
  shape: string;
  kind: "conforming" | "violating" | "degraded";
  prompt: string;
  changes: FileChange[];
  manifest?: Record<string, unknown>;
  nodeModules?: Record<string, string>;
  extract: RecordedClaim[] | "unavailable";
  match?: RecordedMatch[] | "unavailable";
  expected: CorpusExpectation;
}

const HTTP_BEFORE = `export async function request(url) {
  const res = await fetch(url);
  return res.json();
}
`;

const HTTP_AFTER = `export async function request(url) {
  const res = await fetch(url);
  return res.json();
}

export async function retryRequest(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await request(url);
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
}
`;

const CLIENT_BEFORE = `import axios from "axios";

const client = axios.create({ baseURL: "https://api.example.com" });

export async function fetchJson(url) {
  const res = await client.get(url);
  return res.data;
}
`;

const CLIENT_RATE_LIMITED = `import axios from "axios";

const client = axios.create({ baseURL: "https://api.example.com" });

let tokens = 5;

export function applyRateLimit() {
  if (tokens <= 0) return false;
  tokens -= 1;
  return true;
}

export async function fetchJson(url) {
  if (!applyRateLimit()) throw new Error("rate limited");
  const res = await client.get(url);
  return res.data;
}
`;

const CLIENT_THROTTLED = `import axios from "axios";

const client = axios.create({ baseURL: "https://api.example.com" });

export async function fetchJson(url) {
  client.throttle({ rate: 5, per: 1000 });
  const res = await client.get(url);
  return res.data;
}
`;

const PAGINATION_BEFORE = `export function paginate(items, size) {
  const pages = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages;
}
`;

const PAGINATION_REWRITTEN = `export function paginate(items, size, cursor) {
  const start = cursor === undefined ? 0 : decodeCursor(cursor);
  const slice = items.slice(start, start + size);
  const next = start + size < items.length ? encodeCursor(start + size) : null;
  return { items: slice, next };
}

export function encodeCursor(offset) {
  return Buffer.from(String(offset)).toString("base64");
}

export function decodeCursor(cursor) {
  return Number(Buffer.from(cursor, "base64").toString("utf8"));
}
`;

const DURATION_HELPER = `export function formatDuration(ms) {
  if (ms < 1000) return ms + "ms";
  return (ms / 1000).toFixed(1) + "s";
}
`;

const USER_BEFORE = `export function createUser(input) {
  if (!input.email.includes("@")) throw new Error("bad email");
  if (input.name.length < 2) throw new Error("bad name");
  if (input.password.length < 8) throw new Error("bad password");
  return { email: input.email, name: input.name };
}
`;

const USER_AFTER = `import { validateInput } from "./validate.js";

export function createUser(input) {
  validateInput(input);
  return { email: input.email, name: input.name };
}
`;

const VALIDATE_NEW = `export function validateEmail(email) {
  if (!email.includes("@")) throw new Error("bad email");
}

export function validateName(name) {
  if (name.length < 2) throw new Error("bad name");
}

export function validatePassword(password) {
  if (password.length < 8) throw new Error("bad password");
}

export function validateInput(input) {
  validateEmail(input.email);
  validateName(input.name);
  validatePassword(input.password);
}
`;

const FORMAT_BEFORE = `export function total(rows){
    return rows.reduce((sum,row)=>sum+row.amount,0);
}
export function average(rows){
    return total(rows)/rows.length;
}
`;

const FORMAT_AFTER = `export function total(rows) {
  return rows.reduce((sum, row) => sum + row.amount, 0);
}
export function average(rows) {
  return total(rows) / rows.length;
}
`;

const PYTHON_SCRIPT = `import sys

VERSION = "1.4.0"

def main():
    sys.stdout.write(VERSION + "\\n")
    return 0

if __name__ == "__main__":
    sys.exit(main())
`;

const CACHE_BEFORE = `const store = new Map();

export const cacheTtlMs = 5 * 60 * 1000;

export function readCached(key, load) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < cacheTtlMs) return hit.value;
  const value = load();
  store.set(key, { value, at: Date.now() });
  return value;
}
`;

const CACHE_AFTER = `const store = new Map();

export function readCached(key, load) {
  store.clear();
  return load();
}
`;

const RENAME_BEFORE = `import { request } from "./http.js";

export async function fetchJsonWithRetry(url, attempts) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await request(url);
    } catch (error) {
      if (attempt === attempts - 1) throw error;
    }
  }
}
`;

const RENAME_AFTER = `import { request } from "./http.js";

export async function requestJsonWithRetry(url, attempts) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await request(url);
    } catch (error) {
      if (attempt === attempts - 1) throw error;
    }
  }
}
`;

const VALIDATION_BEFORE = `export function checkForm(form) {
  return { ok: true };
}
`;

const VALIDATION_PARTIAL = `export function checkForm(form) {
  if (!form.email.includes("@")) return { ok: false };
  return { ok: true };
}
`;

const METRICS_USE = `const metrics = require("metrics-lite");

const requests = metrics.counter("requests");

function record(route) {
  metrics.histogram("latency", route);
  return requests;
}

module.exports = { record };
`;

const PAGINATION_TEST = `import { expect, test } from "bun:test";
import { paginate } from "./pagination.js";

test("paginate splits items into pages of the requested size", () => {
  expect(paginate([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
});
`;

const README_BEFORE = `# api client

A small wrapper over axios.
`;

const README_AFTER = `# api client

A small wrapper over axios.

## retryRequest

\`retryRequest(url)\` calls \`request\` and retries once when the first attempt throws.
`;

const TODO_BEFORE = `export function normalize(value) {
  const trimmed = String(value).trim();
  const collapsed = trimmed.replace(/\\s+/g, " ");
  return collapsed.toLowerCase();
}
`;

const TODO_AFTER = `export function normalize(value) {
  const trimmed = String(value).trim();
  return trimmed.replace(/\\s+/g, " ").toLowerCase();
}
`;

const OFF_BY_ONE_BEFORE = `export function lastPage(total, size) {
  return Math.ceil(total / size) + 1;
}
`;

const OFF_BY_ONE_AFTER = `export function lastPage(total, size) {
  return Math.ceil(total / size);
}
`;

export const CORPUS_CASES: CorpusCase[] = [
  {
    id: "conforming-retry-helper",
    shape: "a diff that delivers every requirement of a small, well-scoped prompt",
    kind: "conforming",
    prompt:
      "add a retryRequest helper to the http client that retries failed requests twice, and export it",
    changes: [{ path: "http.js", before: HTTP_BEFORE, after: HTTP_AFTER }],
    extract: [
      {
        claim: "A retryRequest helper function is added to the http client",
        kind: "structural",
        keywords: ["retryrequest", "helper", "http", "client"],
        sourceText: "add a retryRequest helper to the http client",
      },
      {
        claim: "The helper retries requests that fail",
        kind: "behavior",
        keywords: ["retry", "request", "fail"],
        sourceText: "retries failed requests",
      },
      {
        claim: "The helper retries each request at most twice",
        kind: "constraint",
        keywords: ["retry", "twice", "request"],
        sourceText: "retries failed requests twice",
      },
      {
        claim: "The retryRequest helper is exported",
        kind: "structural",
        keywords: ["export", "retryrequest"],
        sourceText: "export it",
      },
    ],
    match: [
      {
        claim_id: "c1",
        hunk_ids: ["h1"],
        status: "delivered",
      },
      {
        claim_id: "c2",
        hunk_ids: ["h1"],
        status: "delivered",
      },
      {
        claim_id: "c3",
        hunk_ids: ["h1"],
        status: "delivered",
      },
      {
        claim_id: "c4",
        hunk_ids: ["h1"],
        status: "delivered",
      },
    ],
    expected: {
      verdict: "allow",
      claims: ["delivered", "delivered", "delivered", "delivered"],
      scopeCreep: false,
      hallucinations: 0,
    },
  },
  {
    id: "dropped-requirement",
    shape: "a diff that implements one requirement and silently ignores a second",
    kind: "violating",
    prompt: "add rate limiting to the api client and log every rate-limited request",
    changes: [{ path: "api-client.js", before: CLIENT_BEFORE, after: CLIENT_RATE_LIMITED }],
    manifest: { dependencies: { axios: "^1.18.1" } },
    extract: [
      {
        claim: "API client implements request rate limiting mechanism",
        kind: "structural",
        keywords: ["api", "client", "rate", "limiting"],
        sourceText: "add rate limiting to the api client",
      },
      {
        claim: "Rate limiting prevents requests exceeding configured frequency threshold",
        kind: "behavior",
        keywords: ["rate", "limiting", "request", "threshold"],
        sourceText: "add rate limiting to the api client",
      },
      {
        claim: "Each rate-limited request produces a log entry",
        kind: "behavior",
        keywords: ["log", "rate", "limited", "request"],
        sourceText: "log every rate-limited request",
      },
      {
        claim: "No rate-limited request escapes logging",
        kind: "constraint",
        keywords: ["log", "rate", "limited", "request"],
        sourceText: "log every rate-limited request",
      },
    ],
    match: [
      {
        claim_id: "c1",
        hunk_ids: ["h1"],
        status: "delivered",
      },
      {
        claim_id: "c2",
        hunk_ids: ["h1"],
        status: "delivered",
      },
      {
        claim_id: "c3",
        hunk_ids: [],
        status: "dropped",
      },
      {
        claim_id: "c4",
        hunk_ids: [],
        status: "dropped",
      },
    ],
    expected: {
      verdict: "block",
      claims: ["delivered", "delivered", "dropped", "dropped"],
      scopeCreep: false,
      hallucinations: 0,
    },
  },
  {
    id: "unrequested-scope",
    shape: "a diff that delivers a one-function request and also rewrites an untouched module",
    kind: "violating",
    prompt: "add a formatDuration helper that renders milliseconds as a short string",
    changes: [
      { path: "duration.js", after: DURATION_HELPER },
      { path: "pagination.js", before: PAGINATION_BEFORE, after: PAGINATION_REWRITTEN },
    ],
    extract: [
      {
        claim: "Create a helper function named formatDuration",
        kind: "structural",
        keywords: ["formatduration", "helper"],
        sourceText: "add a formatDuration helper",
      },
      {
        claim: "Function accepts milliseconds value as input",
        kind: "structural",
        keywords: ["formatduration", "milliseconds"],
        sourceText: "renders milliseconds",
      },
      {
        claim: "Function returns a string value",
        kind: "structural",
        keywords: ["formatduration", "string"],
        sourceText: "as a short string",
      },
      {
        claim: "Output string uses a short compact format",
        kind: "behavior",
        keywords: ["formatduration", "short", "format"],
        sourceText: "renders ... as a short string",
      },
    ],
    match: [
      {
        claim_id: "c1",
        hunk_ids: ["h1"],
        status: "delivered",
      },
      {
        claim_id: "c2",
        hunk_ids: ["h1"],
        status: "delivered",
      },
      {
        claim_id: "c3",
        hunk_ids: ["h1"],
        status: "delivered",
      },
      {
        claim_id: "c4",
        hunk_ids: ["h1"],
        status: "delivered",
      },
    ],
    expected: {
      verdict: "warn",
      claims: ["delivered", "delivered", "delivered", "delivered"],
      scopeCreep: true,
      hallucinations: 0,
    },
  },
  {
    id: "hallucinated-member-curated",
    shape: "an added call to a method the curated axios surface does not have",
    kind: "violating",
    prompt: "throttle outgoing requests on the axios client to five per second",
    changes: [{ path: "api-client.js", before: CLIENT_BEFORE, after: CLIENT_THROTTLED }],
    manifest: { dependencies: { axios: "^1.18.1" } },
    extract: [
      {
        claim: "Axios client applies rate limiting to outgoing requests",
        kind: "behavior",
        keywords: ["axios", "throttle", "requests", "rate"],
        sourceText: "throttle outgoing requests on the axios client",
      },
      {
        claim: "Request throttle enforces five requests per second maximum",
        kind: "constraint",
        keywords: ["throttle", "requests", "per second", "limit"],
        sourceText: "to five per second",
      },
    ],
    match: [
      {
        claim_id: "c1",
        hunk_ids: ["h1"],
        status: "partial",
      },
      {
        claim_id: "c2",
        hunk_ids: ["h1"],
        status: "delivered",
      },
    ],
    expected: {
      verdict: "block",
      claims: "unpinned",
      scopeCreep: false,
      hallucinations: 1,
    },
  },
  {
    id: "hallucinated-member-extracted",
    shape: "an added call to a method an untyped installed package does not export",
    kind: "violating",
    prompt: "record a latency histogram for each route using the metrics helper",
    changes: [{ path: "metrics.js", after: METRICS_USE }],
    manifest: { dependencies: { "metrics-lite": "^1.0.0" } },
    nodeModules: {
      "metrics-lite/package.json": '{"name":"metrics-lite","version":"1.0.0","main":"index.js"}',
      "metrics-lite/index.js": [
        "function counter(name) { return { name: name, value: 0 }; }",
        "function gauge(name) { return { name: name, value: 0 }; }",
        "module.exports = { counter: counter, gauge: gauge };",
        "",
      ].join("\n"),
    },
    extract: [
      {
        claim: "Record a latency histogram that captures request duration metrics",
        kind: "behavior",
        keywords: ["record", "latency", "histogram"],
        sourceText: "record a latency histogram",
      },
      {
        claim: "Record a separate histogram for each route",
        kind: "constraint",
        keywords: ["histogram", "route", "each"],
        sourceText: "for each route",
      },
      {
        claim: "Use the metrics helper utility to implement histogram recording",
        kind: "structural",
        keywords: ["metrics", "helper", "histogram"],
        sourceText: "using the metrics helper",
      },
    ],
    match: [
      {
        claim_id: "c1",
        hunk_ids: ["h1"],
        status: "partial",
      },
      {
        claim_id: "c2",
        hunk_ids: ["h1"],
        status: "partial",
      },
      {
        claim_id: "c3",
        hunk_ids: ["h1"],
        status: "delivered",
      },
    ],
    expected: {
      verdict: "block",
      claims: "unpinned",
      scopeCreep: false,
      hallucinations: 1,
    },
  },
  {
    id: "legitimate-wide-refactor",
    shape: "an extract-module refactor that touches many lines and was entirely requested",
    kind: "conforming",
    prompt:
      "extract the validation logic out of createUser into its own validate module and call it from createUser",
    changes: [
      { path: "validate.js", after: VALIDATE_NEW },
      { path: "user.js", before: USER_BEFORE, after: USER_AFTER },
    ],
    extract: [
      {
        claim: "Create a new validate module to contain validation logic extracted from createUser",
        kind: "structural",
        keywords: ["validate", "module", "extraction", "createuser"],
        sourceText: "extract the validation logic out of createUser into its own validate module",
      },
      {
        claim: "The validate module contains all validation logic that was in createUser",
        kind: "behavior",
        keywords: ["validate", "module", "validation", "logic"],
        sourceText: "extract the validation logic out of createUser into its own validate module",
      },
      {
        claim: "createUser must call the validate module to perform validation",
        kind: "behavior",
        keywords: ["createuser", "validate", "call"],
        sourceText: "call it from createUser",
      },
      {
        claim: "createUser still performs user creation after calling the validate module",
        kind: "preservation",
        keywords: ["createuser", "user", "creation"],
        sourceText:
          "extract the validation logic out of createUser into its own validate module and call it from createUser",
      },
    ],
    match: [
      {
        claim_id: "c1",
        hunk_ids: ["h1"],
        status: "delivered",
      },
      {
        claim_id: "c2",
        hunk_ids: ["h1"],
        status: "partial",
      },
      {
        claim_id: "c3",
        hunk_ids: ["h2"],
        status: "delivered",
      },
    ],
    expected: {
      verdict: "allow",
      claims: ["delivered", "delivered", "delivered", "delivered"],
      scopeCreep: false,
      hallucinations: 0,
    },
  },
  {
    id: "formatting-sweep",
    shape: "a pure reformat of two functions with no semantic change",
    kind: "conforming",
    prompt: "run the formatter over totals.js, no behaviour change",
    changes: [{ path: "totals.js", before: FORMAT_BEFORE, after: FORMAT_AFTER }],
    extract: [
      {
        claim: "Apply code formatter to totals.js",
        kind: "structural",
        keywords: ["formatter", "format", "totals.js"],
        sourceText: "run the formatter over totals.js",
      },
      {
        claim: "Preserve all existing behavior of totals.js",
        kind: "preservation",
        keywords: ["preserve", "behavior", "totals.js"],
        sourceText: "no behaviour change",
      },
    ],
    match: [
      {
        claim_id: "c1",
        hunk_ids: ["h1"],
        status: "delivered",
      },
    ],
    expected: {
      verdict: "allow",
      claims: ["delivered", "delivered"],
      scopeCreep: false,
      hallucinations: 0,
    },
  },
  {
    id: "foreign-language-file",
    shape: "a requested Python script the JavaScript classifier cannot read",
    kind: "conforming",
    prompt: "add a python script under scripts that prints the build version",
    changes: [{ path: "scripts/version.py", after: PYTHON_SCRIPT }],
    extract: [
      {
        claim: "Python script file must be created in the scripts directory",
        kind: "structural",
        keywords: ["python", "script", "scripts", "directory"],
        sourceText: "add a python script under scripts",
      },
      {
        claim: "Script prints the build version to standard output",
        kind: "behavior",
        keywords: ["script", "prints", "build", "version"],
        sourceText: "prints the build version",
      },
    ],
    match: [
      {
        claim_id: "c1",
        hunk_ids: ["h1"],
        status: "delivered",
      },
      {
        claim_id: "c2",
        hunk_ids: ["h1"],
        status: "delivered",
      },
    ],
    expected: {
      verdict: "allow",
      claims: ["delivered", "delivered"],
      scopeCreep: false,
      hallucinations: 0,
    },
  },
  {
    id: "contradictory-prompt",
    shape: "a prompt whose two requirements cannot both hold, half delivered and half violated",
    kind: "violating",
    prompt:
      "make the cache always fresh by never caching, and keep the existing five minute cache ttl",
    changes: [{ path: "cache.js", before: CACHE_BEFORE, after: CACHE_AFTER }],
    extract: [
      {
        claim: "Disable caching so the cache is always fresh",
        kind: "behavior",
        keywords: ["cache", "disable", "fresh"],
        sourceText: "make the cache always fresh by never caching",
      },
      {
        claim: "Preserve the existing five minute cache ttl setting",
        kind: "preservation",
        keywords: ["cache", "ttl", "preserve", "five"],
        sourceText: "keep the existing five minute cache ttl",
      },
    ],
    match: [
      {
        claim_id: "c1",
        hunk_ids: ["h1"],
        status: "delivered",
      },
    ],
    expected: {
      verdict: "warn",
      claims: ["delivered", "partial"],
      scopeCreep: false,
      hallucinations: 0,
    },
  },
  {
    id: "behaviour-preserving-rename",
    shape: "a rename of the very function a preservation claim names, with its behaviour intact",
    kind: "conforming",
    prompt:
      "rename fetchJsonWithRetry to requestJsonWithRetry, and keep the retry behaviour exactly as it is",
    changes: [{ path: "retry.js", before: RENAME_BEFORE, after: RENAME_AFTER }],
    extract: [
      {
        claim: "Rename function fetchJsonWithRetry to requestJsonWithRetry.",
        kind: "structural",
        keywords: ["rename", "function", "requestjsonwithretry"],
        sourceText: "rename fetchJsonWithRetry to requestJsonWithRetry",
      },
      {
        claim: "Retry mechanism behavior must remain unchanged after renaming.",
        kind: "preservation",
        keywords: ["retry", "behavior", "unchanged"],
        sourceText: "keep the retry behaviour exactly as it is",
      },
    ],
    match: [
      {
        claim_id: "c1",
        hunk_ids: ["h1"],
        status: "delivered",
      },
    ],
    expected: {
      verdict: "allow",
      claims: ["delivered", "delivered"],
      scopeCreep: false,
      hallucinations: 0,
    },
  },
  {
    id: "partial-delivery",
    shape: "a requirement half met: the check exists but the requested error detail does not",
    kind: "violating",
    prompt:
      "validate the email field in checkForm and return a helpful error message when it fails",
    changes: [{ path: "form.js", before: VALIDATION_BEFORE, after: VALIDATION_PARTIAL }],
    extract: [
      {
        claim: "Validate the email field in the checkForm function",
        kind: "behavior",
        keywords: ["validate", "email", "checkform"],
        sourceText: "validate the email field in checkForm",
      },
      {
        claim: "Return helpful error message when email validation fails",
        kind: "behavior",
        keywords: ["return", "error", "message", "helpful"],
        sourceText: "return a helpful error message when it fails",
      },
    ],
    match: [
      {
        claim_id: "c1",
        hunk_ids: ["h1"],
        status: "delivered",
      },
      {
        claim_id: "c2",
        hunk_ids: ["h1"],
        status: "partial",
      },
    ],
    expected: {
      verdict: "warn",
      claims: ["delivered", "partial"],
      scopeCreep: false,
      hallucinations: 0,
    },
  },
  {
    id: "llm-unavailable-with-finding",
    shape: "no llm credential, and a deterministic hallucination the run must still report",
    kind: "violating",
    prompt: "throttle outgoing requests on the axios client to five per second",
    changes: [{ path: "api-client.js", before: CLIENT_BEFORE, after: CLIENT_THROTTLED }],
    manifest: { dependencies: { axios: "^1.18.1" } },
    extract: "unavailable",
    expected: {
      verdict: "block",
      claims: [],
      scopeCreep: false,
      hallucinations: 1,
    },
  },
  {
    id: "llm-match-unavailable",
    shape: "extraction works but the match call fails, so unmatched claims cannot be judged",
    kind: "degraded",
    prompt: "add a formatDuration helper that renders milliseconds as a short string",
    changes: [{ path: "duration.js", after: DURATION_HELPER }],
    extract: [
      {
        claim: "Create a formatDuration helper function",
        kind: "structural",
        keywords: ["formatduration", "helper", "function"],
        sourceText: "add a formatDuration helper",
      },
      {
        claim: "Helper accepts milliseconds as input",
        kind: "behavior",
        keywords: ["formatduration", "milliseconds", "input"],
        sourceText: "renders milliseconds",
      },
      {
        claim: "Helper returns duration as a short string",
        kind: "behavior",
        keywords: ["formatduration", "duration", "string"],
        sourceText: "renders milliseconds as a short string",
      },
    ],
    match: "unavailable",
    expected: {
      verdict: "warn",
      claims: ["partial", "partial", "partial"],
      scopeCreep: false,
      hallucinations: 0,
    },
  },
  {
    id: "test-only-change",
    shape: "a requested test file and nothing else",
    kind: "conforming",
    prompt: "add a test for the paginate helper",
    changes: [{ path: "pagination.test.js", after: PAGINATION_TEST }],
    extract: [
      {
        claim: "A test for the paginate helper function must be created",
        kind: "structural",
        keywords: ["test", "paginate", "helper"],
        sourceText: "add a test for the paginate helper",
      },
      {
        claim: "The test verifies the paginate helper produces expected output",
        kind: "behavior",
        keywords: ["test", "verify", "paginate", "output"],
        sourceText: "add a test for the paginate helper",
      },
    ],
    match: [
      {
        claim_id: "c1",
        hunk_ids: ["h1"],
        status: "delivered",
      },
      {
        claim_id: "c2",
        hunk_ids: ["h1"],
        status: "delivered",
      },
    ],
    expected: {
      verdict: "allow",
      claims: ["delivered", "delivered"],
      scopeCreep: false,
      hallucinations: 0,
    },
  },
  {
    id: "docs-only-change",
    shape: "a requested readme section and nothing else",
    kind: "conforming",
    prompt: "document the retryRequest helper in the readme",
    changes: [{ path: "README.md", before: README_BEFORE, after: README_AFTER }],
    extract: [
      {
        claim: "Add documentation explaining what the retryRequest helper does",
        kind: "behavior",
        keywords: ["retryrequest", "documentation", "helper"],
        sourceText: "document the retryRequest helper",
      },
      {
        claim: "Documentation for retryRequest helper must be placed in the readme",
        kind: "structural",
        keywords: ["retryrequest", "documentation", "readme"],
        sourceText: "in the readme",
      },
    ],
    match: [
      {
        claim_id: "c1",
        hunk_ids: ["h1"],
        status: "delivered",
      },
      {
        claim_id: "c2",
        hunk_ids: ["h1"],
        status: "delivered",
      },
    ],
    expected: {
      verdict: "allow",
      claims: ["delivered", "delivered"],
      scopeCreep: false,
      hallucinations: 0,
    },
  },
  {
    id: "manifest-only-change",
    shape: "a requested dependency range bump touching only package.json",
    kind: "conforming",
    prompt: "bump the axios range to ^1.18.1",
    changes: [
      {
        path: "package.json",
        before: '{\n  "dependencies": {\n    "axios": "^1.12.0"\n  }\n}\n',
        after: '{\n  "dependencies": {\n    "axios": "^1.18.1"\n  }\n}\n',
      },
    ],
    manifest: { dependencies: { axios: "^1.18.1" } },
    extract: [
      {
        claim: "Update axios dependency range specification to ^1.18.1",
        kind: "behavior",
        keywords: ["axios", "range", "bump", "version"],
        sourceText: "bump the axios range to ^1.18.1",
      },
    ],
    match: [
      {
        claim_id: "c1",
        hunk_ids: ["h1"],
        status: "delivered",
      },
    ],
    expected: {
      verdict: "allow",
      claims: ["delivered"],
      scopeCreep: false,
      hallucinations: 0,
    },
  },
  {
    id: "single-line-fix",
    shape: "a one-line bug fix exactly as asked",
    kind: "conforming",
    prompt: "fix the off-by-one in lastPage",
    changes: [{ path: "paging.js", before: OFF_BY_ONE_BEFORE, after: OFF_BY_ONE_AFTER }],
    extract: [
      {
        claim: "Fix the off-by-one error in lastPage",
        kind: "behavior",
        keywords: ["lastpage", "off-by-one", "fix"],
        sourceText: "fix the off-by-one in lastPage",
      },
    ],
    match: [
      {
        claim_id: "c1",
        hunk_ids: ["h1"],
        status: "delivered",
      },
    ],
    expected: {
      verdict: "allow",
      claims: ["delivered"],
      scopeCreep: false,
      hallucinations: 0,
    },
  },
  {
    id: "inline-simplification",
    shape: "a requested simplification that removes a local variable and shortens the body",
    kind: "conforming",
    prompt: "simplify normalize by dropping the intermediate collapsed variable",
    changes: [{ path: "normalize.js", before: TODO_BEFORE, after: TODO_AFTER }],
    extract: [
      {
        claim: "Drop intermediate variable collapsed from normalize function",
        kind: "behavior",
        keywords: ["collapsed", "normalize", "intermediate"],
        sourceText: "dropping the intermediate collapsed variable",
      },
      {
        claim: "Normalize function behavior must remain unchanged",
        kind: "preservation",
        keywords: ["normalize", "behavior", "unchanged"],
        sourceText: "simplify normalize by dropping the intermediate collapsed variable",
      },
      {
        claim: "Normalize function should be simplified",
        kind: "behavior",
        keywords: ["normalize", "simplify"],
        sourceText: "simplify normalize",
      },
    ],
    match: [
      {
        claim_id: "c1",
        hunk_ids: [],
        status: "dropped",
      },
      {
        claim_id: "c3",
        hunk_ids: ["h1"],
        status: "partial",
      },
    ],
    expected: {
      verdict: "allow",
      claims: ["delivered", "delivered", "delivered"],
      scopeCreep: false,
      hallucinations: 0,
    },
  },
];
