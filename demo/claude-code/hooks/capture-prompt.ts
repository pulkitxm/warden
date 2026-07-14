import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface PromptEvent {
  session_id?: string;
  cwd?: string;
  prompt?: string;
}

const raw = await new Response(Bun.stdin.stream()).text();
let event: PromptEvent;
try {
  event = JSON.parse(raw) as PromptEvent;
} catch {
  process.exit(0);
}

const prompt = (event.prompt ?? "").trim();
if (prompt === "" || prompt.startsWith("/")) process.exit(0);

const root = event.cwd ?? process.cwd();
const dir = join(root, ".warden");
mkdirSync(dir, { recursive: true });
const sessionFile = join(dir, "session");
const promptFile = join(dir, "prompt.txt");

let lastSession = "";
try {
  lastSession = readFileSync(sessionFile, "utf8").trim();
} catch {}

const session = (event.session_id ?? "").trim();
if (session !== "" && session !== lastSession) {
  writeFileSync(sessionFile, `${session}\n`);
  writeFileSync(promptFile, `${prompt}\n`);
} else {
  appendFileSync(promptFile, `${prompt}\n`);
}
