/**
 * The verdict engine — the single path shared by wnpm, wnpx, and the agent JSON.
 *
 *   parse spec -> registry -> [slopsquat? blocklist?] -> cache(by integrity)
 *     -> fetch+verify tarballs -> diff -> analyze -> score -> llm summary -> cache
 */

import { resolvePackage, fetchTarball } from "./registry.ts";
import { readTgz } from "./tar.ts";
import { verifyIntegrity } from "./integrity.ts";
import { diffVersions } from "./diff.ts";
import { analyze, type AnalysisInput } from "./heuristics/index.ts";
import { popularityOf } from "./distance/index.ts";
import { score } from "./score.ts";
import { explain } from "./llm.ts";
import { VerdictCache } from "./cache.ts";
import { defaultBlocklist, defaultHallucinated, type Blocklist } from "./intel/index.ts";
import { ANALYZER_VERSION, SCHEMA_VERSION, type Verdict } from "./schema.ts";

export interface EngineDeps {
  cache?: VerdictCache;
  blocklist?: Blocklist;
  skipCache?: boolean;
}

/** Split "name@version" while respecting scoped names (@scope/pkg@1.2.3). */
export function parseSpec(spec: string): { name: string; version?: string } {
  const at = spec.lastIndexOf("@");
  if (at > 0) return { name: spec.slice(0, at), version: spec.slice(at + 1) };
  return { name: spec };
}

function blocklistVerdict(name: string, version: string, integrity: string, id: string): Verdict {
  return {
    schema_version: SCHEMA_VERSION,
    package: name,
    version,
    integrity,
    verdict: "block",
    risk_score: 100,
    categories: ["known_malware"],
    summary: `${name}@${version} is on the known-malware blocklist (${id}). Installation blocked.`,
    evidence: [{ file: "-", detail: `blocklist entry ${id}` }],
    analyzer_version: ANALYZER_VERSION,
    source: "blocklist",
  };
}

/** Score one package spec end to end. */
export async function checkPackage(spec: string, deps: EngineDeps = {}): Promise<Verdict> {
  const blocklist = deps.blocklist ?? defaultBlocklist;
  const cache = deps.cache ?? new VerdictCache();
  const { name, version } = parseSpec(spec);

  // Known LLM-hallucinated name (slopsquat) — block even if since registered.
  if (defaultHallucinated.has(name)) {
    return {
      schema_version: SCHEMA_VERSION,
      package: name,
      version: version ?? "unknown",
      integrity: "",
      verdict: "block",
      risk_score: 90,
      categories: ["slopsquat"],
      summary: `"${name}" is a known LLM-hallucinated (slopsquat) package name. Coding agents invent this name; do not install it.`,
      evidence: [{ file: "-", detail: "on the curated hallucinated-name list" }],
      analyzer_version: ANALYZER_VERSION,
      source: "blocklist",
    };
  }

  const meta = await resolvePackage(name, version);

  // Slopsquat: the name does not exist on the registry at all.
  if (!meta.existsOnRegistry) {
    const input: AnalysisInput = {
      name,
      version: version ?? "unknown",
      isNewPackage: true,
      meta: { maintainers: [], existsOnRegistry: false },
      addedScripts: {},
      changedScripts: {},
      scanFiles: [],
    };
    return score(analyze(input), { package: name, version: version ?? "unknown", integrity: "", source: "heuristics" });
  }

  // Requested exact version is missing (removed/unpublished): do NOT analyze a
  // fallback version. Still honor the blocklist against the REQUESTED version
  // (a removed-but-known-bad version must stay blocked), otherwise error out.
  if (meta.requestedVersionMissing && version) {
    const removedHit = blocklist.match(name, version);
    if (removedHit) return blocklistVerdict(name, version, "", removedHit.id);
    throw new Error(`version ${version} of ${name} was not found on the registry (removed or never published)`);
  }

  // Blocklist hard-block (before any analysis).
  const hit = blocklist.match(meta.name, meta.version);
  if (hit) return blocklistVerdict(meta.name, meta.version, meta.integrity ?? "", hit.id);

  const integrity = meta.integrity ?? "";
  if (!deps.skipCache && integrity) {
    const cached = cache.get(integrity, ANALYZER_VERSION);
    if (cached) return cached;
  }

  // Fetch + integrity-verify the target tarball; fetch the previous for diffing.
  let current: ReturnType<typeof readTgz> = [];
  let previous: ReturnType<typeof readTgz> | undefined;
  if (meta.tarballUrl) {
    const bytes = await fetchTarball(meta.tarballUrl);
    if (integrity && !verifyIntegrity(bytes, integrity)) {
      throw new Error(`integrity mismatch for ${meta.name}@${meta.version}`);
    }
    current = readTgz(bytes);
  }
  if (meta.previousTarballUrl) {
    try {
      previous = readTgz(await fetchTarball(meta.previousTarballUrl));
    } catch {
      previous = undefined; // fall back to metadata-only diff
    }
  }

  // Establishment: downloads >= 100k, OR on the bundled popular list, OR the
  // downloads API couldn't be reached (treat unknown conservatively — a
  // downloads-API outage must not flip a popular package to "obscure" and
  // false-block it; issue I10). Tradeoff: during such an outage, a genuinely
  // obscure package's name/capability attack may only WARN.
  const established = (meta.weeklyDownloads ?? 0) >= 100_000 || popularityOf(meta.name) !== undefined || Boolean(meta.downloadsUnknown);

  const d = diffVersions(current, previous, { metaScripts: meta.scripts, prevMetaScripts: meta.previousScripts });
  const input: AnalysisInput = {
    name: meta.name,
    version: meta.version,
    isNewPackage: d.isNewPackage,
    meta: {
      ageDays: meta.ageDays,
      weeklyDownloads: meta.weeklyDownloads,
      deprecated: meta.deprecated,
      maintainers: meta.maintainers,
      previousMaintainers: meta.previousMaintainers,
      maintainerEmailChanged: meta.maintainerEmailChanged,
      hasProvenance: meta.hasProvenance,
      previousHadProvenance: meta.previousHadProvenance,
      existsOnRegistry: true,
      established,
    },
    addedScripts: d.addedScripts,
    changedScripts: d.changedScripts,
    scanFiles: d.scanFiles,
  };

  const base = score(analyze(input), { package: meta.name, version: meta.version, integrity, source: "heuristics", established });

  // Stage-2 LLM only rewrites the summary (verdict stays deterministic).
  const { summary } = await explain(base);
  const verdict: Verdict = { ...base, summary };

  if (integrity) cache.set(integrity, verdict, Date.now());
  return verdict;
}
