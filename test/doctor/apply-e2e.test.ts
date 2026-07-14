import { afterAll, beforeAll, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type MiniRegistry, startMiniRegistry } from "../../fixtures/registry/server.ts";
import { VerdictCache } from "../../src/cache.ts";
import { runDoctor } from "../../src/doctor/index.ts";
import { checkPackage } from "../../src/engine.ts";

const doctorProject = fileURLToPath(new URL("../../fixtures/doctor-project", import.meta.url));

let reg: MiniRegistry;
let workDir: string;

beforeAll(() => {
  reg = startMiniRegistry();
  process.env.WNPM_REGISTRY = reg.url;
  process.env.WNPM_DOWNLOADS = reg.downloadsUrl;
  process.env.WNPM_OSV = reg.url;
  delete process.env.OPENAI_API_KEY;
  workDir = mkdtempSync(join(tmpdir(), "wnpm-apply-e2e-"));
  cpSync(doctorProject, workDir, { recursive: true });
});
afterAll(() => {
  reg.stop();
  delete process.env.WNPM_OSV;
  rmSync(workDir, { recursive: true, force: true });
});

const check = (spec: string) => checkPackage(spec, { cache: new VerdictCache(":memory:") });
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as unknown;

test.skipIf(!Bun.which("npm"))(
  "doctor --apply repairs a real project end to end: verified fix installed, hijacked fix refused",
  async () => {
    const report = await runDoctor(workDir, { apply: true }, { check });

    expect(report.recommended).toBe("minimal");
    expect(report.applied).toBe(true);
    const verification = report.plans.find((p) => p.id === "minimal")?.verification;
    expect(verification?.passed).toBe(true);
    expect(verification?.steps.map((s) => s.name)).toEqual(["install", "test"]);
    expect(verification?.steps.every((s) => s.ok && s.ms >= 0)).toBe(true);

    const manifest = readJson(join(workDir, "package.json")) as {
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies["acme-json"]).toBe("2.1.4");
    expect(manifest.dependencies["acme-http"]).toBe("^1.0.0");

    const lock = readJson(join(workDir, "package-lock.json")) as {
      packages: Record<string, { version?: string }>;
    };
    expect(lock.packages["node_modules/acme-json"]?.version).toBe("2.1.4");

    const installed = readJson(join(workDir, "node_modules", "acme-json", "package.json")) as {
      version: string;
    };
    expect(installed.version).toBe("2.1.4");
  },
  60_000,
);

test.skipIf(!Bun.which("npm"))(
  "re-running doctor after apply reports only the unfixable hijacked package",
  async () => {
    const report = await runDoctor(workDir, { verify: false }, { check });
    expect(report.issues.map((i) => i.name)).toEqual(["acme-http"]);
    expect(report.unfixable).toEqual([
      { name: "acme-http", reason: "every candidate fix was blocked by the supply-chain gate" },
    ]);
    expect(report.plans).toEqual([]);
    expect(report.applied).toBeUndefined();
  },
  60_000,
);
