/**
 * The verdict engine — the single path shared by wnpm, wnpx, and the agent JSON.
 *
 *   parse spec -> registry -> [slopsquat? blocklist?] -> cache(by integrity)
 *     -> fetch+verify tarballs -> diff -> analyze -> score -> llm summary -> cache
 */

import { resolvePackage, fetchTarball } from "@warden/registry";
import { readTgz } from "@warden/tar";
import { verifyIntegrity } from "@warden/sri";
import { diffVersions } from "@warden/diff";
import { analyze, type AnalysisInput } from "@warden/heuristics";
import { score } from "@warden/score";
import { explain } from "@warden/llm";
import { VerdictCache } from "@warden/cache";
import { defaultBlocklist, type Blocklist } from "@warden/intel";
import { ANALYZER_VERSION, SCHEMA_VERSION, type Verdict } from "@warden/schema";

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
  const meta = await resolvePackage(name, version);

  // Slopsquat: the name does not exist on the registry at all.
  if (!meta.existsOnRegistry) {
    const input: AnalysisInput = {
      name,
      version: version ?? "0.0.0",
      isNewPackage: true,
      meta: { maintainers: [], existsOnRegistry: false },
      addedScripts: {},
      changedScripts: {},
      scanFiles: [],
    };
    return score(analyze(input), { package: name, version: version ?? "0.0.0", integrity: "", source: "heuristics" });
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
    },
    addedScripts: d.addedScripts,
    changedScripts: d.changedScripts,
    scanFiles: d.scanFiles,
  };

  const established = (meta.weeklyDownloads ?? 0) >= 100_000;
  const base = score(analyze(input), { package: meta.name, version: meta.version, integrity, source: "heuristics", established });

  // Stage-2 LLM only rewrites the summary (verdict stays deterministic).
  const { summary } = await explain(base);
  const verdict: Verdict = { ...base, summary };

  if (integrity) cache.set(integrity, verdict, Date.now());
  return verdict;
}
