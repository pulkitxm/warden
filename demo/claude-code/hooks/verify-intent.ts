import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface StopEvent {
  cwd?: string;
  stop_hook_active?: boolean;
}

function git(root: string, args: string[]): string {
  const proc = Bun.spawnSync(["git", "-C", root, ...args], { stdout: "pipe", stderr: "ignore" });
  return proc.success ? proc.stdout.toString() : "";
}

function fingerprint(root: string): string {
  const diff = git(root, ["diff", "HEAD"]);
  const status = git(root, ["status", "--porcelain"])
    .split("\n")
    .filter((line) => line !== "" && !line.slice(3).startsWith(".warden"))
    .join("\n");
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .filter((path) => path !== "" && !path.startsWith(".warden"))
    .map((path) => {
      try {
        const info = statSync(join(root, path));
        return `${path}:${info.size}:${info.mtimeMs}`;
      } catch {
        return path;
      }
    })
    .join("\n");
  return Bun.hash(`${diff}\n${status}\n${untracked}`).toString(16);
}

const raw = await new Response(Bun.stdin.stream()).text();
let event: StopEvent;
try {
  event = JSON.parse(raw) as StopEvent;
} catch {
  process.exit(0);
}

const root = event.cwd ?? process.cwd();
const dir = join(root, ".warden");

let prompt = "";
try {
  prompt = readFileSync(join(dir, "prompt.txt"), "utf8").trim();
} catch {}
if (prompt === "") process.exit(0);

const current = fingerprint(root);
const markFile = join(dir, "verified");
let verified = "";
try {
  verified = readFileSync(markFile, "utf8").trim();
} catch {}
if (current === verified) process.exit(0);

const bin = process.env.WARDEN_BIN ?? Bun.which("warden");
if (!bin) process.exit(0);

const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: "1" };
const configured =
  env.WNPM_LLM_PROVIDER ?? env.OPENAI_API_KEY ?? env.GROQ_API_KEY ?? env.OLLAMA_API_KEY;
if (configured === undefined && Bun.which("claude") !== null) env.WNPM_LLM_PROVIDER = "claude";

const run = Bun.spawnSync([bin, "intent", "check"], {
  cwd: root,
  stdout: "pipe",
  stderr: "pipe",
  env,
});
try {
  writeFileSync(markFile, `${current}\n`);
} catch {}

const report = run.stderr.toString().trim();
if (run.exitCode === 0 || run.exitCode >= 30 || report === "") process.exit(0);

if (run.exitCode === 20 && event.stop_hook_active !== true) {
  const reason = [
    "warden intent: the diff does not satisfy the prompt in .warden/prompt.txt.",
    "Fix dropped requirements, remove hallucinated APIs, or revert unrequested changes.",
    "",
    report,
  ].join("\n");
  console.log(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

const context = `warden intent verdict (non-blocking):\n\n${report}`;
console.log(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: "Stop", additionalContext: context },
  }),
);
