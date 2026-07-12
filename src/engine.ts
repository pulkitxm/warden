import { cacheKey, FileVerdictCache, type VerdictCache } from "./cache/index.js";
import { diffPackage, metadataOnlyDiff } from "./diff.js";
import { enrich } from "./enrich/index.js";
import { analyze, score } from "./heuristics/index.js";
import { resolvePackage } from "./registry.js";
import { ENGINE_VERSION, type TarballDiff, type Verdict } from "./types.js";
import { selectProvider } from "./verdict/index.js";

export interface CheckOptions {
  cache?: VerdictCache;
  noCache?: boolean;
  skipEnrichment?: boolean;
}

let defaultCache: FileVerdictCache | undefined;

function getDefaultCache(): FileVerdictCache {
  if (!defaultCache) defaultCache = new FileVerdictCache();
  return defaultCache;
}

export function parseSpec(spec: string): { name: string; requested: string } {
  let s = spec;
  const alias = s.indexOf("@npm:");
  if (alias > 0) s = s.slice(alias + 5);
  const at = s.lastIndexOf("@");
  if (at <= 0) return { name: s, requested: "latest" };
  return { name: s.slice(0, at), requested: s.slice(at + 1) || "latest" };
}

export async function checkPackage(spec: string, opts: CheckOptions = {}): Promise<Verdict> {
  const cache = opts.cache ?? getDefaultCache();
  const { name, requested } = parseSpec(spec);

  const meta = await resolvePackage(name, requested);
  const key = cacheKey(meta.name, meta.version);

  if (!opts.noCache) {
    const hit = await cache.get(key);
    if (hit) return hit;
  }

  let diff: TarballDiff;
  try {
    diff = await diffPackage(meta);
  } catch {
    diff = metadataOnlyDiff(meta);
  }

  const heuristicSignals = analyze(meta, diff);
  const enrichSignals = opts.skipEnrichment ? [] : await enrich(meta);
  const result = score(meta, [...heuristicSignals, ...enrichSignals]);

  const provider = selectProvider(result.level);
  const { explanation, recommendation, llm_used } = await provider.explain({
    package: key,
    score: result.score,
    level: result.level,
    flags: result.flags,
    evidence: result.evidence,
  });

  const verdict: Verdict = {
    package: key,
    risk_score: result.score,
    level: result.level,
    flags: result.flags,
    evidence: result.evidence,
    explanation,
    recommendation,
    cached: false,
    engine_version: ENGINE_VERSION,
    llm_used,
  };

  if (!opts.noCache) await cache.set(key, verdict);
  return verdict;
}
