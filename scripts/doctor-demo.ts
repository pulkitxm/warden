import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMiniRegistry } from "../fixtures/registry/server.ts";

const root = `${import.meta.dir}/..`;
const binary = join(root, "dist", "wnpm");

if (!existsSync(binary)) {
  process.stderr.write("doctor-demo: missing ./dist/wnpm, run make build first\n");
  process.exitCode = 1;
} else {
  const registry = startMiniRegistry();
  const workspace = mkdtempSync(join(tmpdir(), "wnpm-doctor-demo-"));
  cpSync(join(root, "fixtures", "doctor-project"), workspace, { recursive: true });
  const env: Record<string, string | undefined> = {
    ...process.env,
    WNPM_REGISTRY: registry.url,
    WNPM_DOWNLOADS: registry.downloadsUrl,
    WNPM_OSV: registry.url,
    WNPM_CACHE: ":memory:",
  };
  delete env.OPENAI_API_KEY;
  const run = async (flags: string[]) => {
    const child = Bun.spawn([binary, "doctor", "--dir", workspace, ...flags], {
      cwd: root,
      env,
      stdout: "inherit",
      stderr: "inherit",
    });
    await child.exited;
  };
  try {
    await run(["--no-apply"]);
    await run([]);
    process.stdout.write(`${readFileSync(join(workspace, "package.json"), "utf8")}\n`);
  } finally {
    registry.stop();
    process.stdout.write(`doctor demo workspace: ${workspace}\n`);
  }
}
