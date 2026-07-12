/**
 * npm registry client: packument metadata + tarball fetch.
 *
 * Extracts everything the heuristics need, including the provenance/attestation
 * and publisher-email signals that catch account-takeover attacks (axios). No
 * auth required. `WARDEN_REGISTRY` overrides the base URL (used by the mini
 * registry in fixtures/).
 */

// Read at call time (not module load) so tests can point at a mini-registry.
const registryBase = () => process.env.WARDEN_REGISTRY ?? "https://registry.npmjs.org";
const downloadsBase = () => process.env.WARDEN_DOWNLOADS ?? "https://api.npmjs.org/downloads/point/last-week";

export interface PackageMeta {
  name: string;
  version: string;
  existsOnRegistry: boolean;
  /** True when a concrete version was requested but is absent from the registry
   * (removed/unpublished). The engine must NOT analyze a fallback version. */
  requestedVersionMissing?: boolean;
  versions: string[];
  previousVersion?: string;
  publishedAt?: string;
  ageDays?: number;
  maintainers: string[];
  previousMaintainers?: string[];
  maintainerEmailChanged?: boolean;
  hasProvenance?: boolean;
  previousHadProvenance?: boolean;
  weeklyDownloads?: number;
  deprecated?: boolean;
  tarballUrl?: string;
  integrity?: string;
  previousTarballUrl?: string;
  scripts?: Record<string, string>;
  previousScripts?: Record<string, string>;
}

interface PackVersion {
  version: string;
  scripts?: Record<string, string>;
  deprecated?: string;
  dist?: { tarball?: string; integrity?: string; attestations?: unknown };
  _npmUser?: { name?: string; email?: string };
  maintainers?: Array<{ name?: string } | string>;
}
interface Packument {
  name: string;
  "dist-tags"?: Record<string, string>;
  time?: Record<string, string>;
  versions?: Record<string, PackVersion>;
  maintainers?: Array<{ name?: string } | string>;
}

async function getJson<T>(url: string, timeoutMs = 10_000): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function names(list: Array<{ name?: string } | string> | undefined): string[] {
  if (!list) return [];
  return list.map((m) => (typeof m === "string" ? m.split("<")[0]!.trim() : m.name)).filter((n): n is string => Boolean(n));
}

function encodeName(name: string): string {
  return name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
}

/** Resolve full metadata for name@version (version may be a tag or omitted). */
export async function resolvePackage(name: string, version = "latest"): Promise<PackageMeta> {
  const pack = await getJson<Packument>(`${registryBase()}/${encodeName(name)}`);
  if (!pack || !pack.versions) {
    return { name, version, existsOnRegistry: false, versions: [], maintainers: [] };
  }

  const time = pack.time ?? {};
  const ordered = Object.keys(pack.versions).sort((a, b) => (Date.parse(time[a] ?? "") || 0) - (Date.parse(time[b] ?? "") || 0));
  const tags = pack["dist-tags"] ?? {};
  let resolved = tags[version] ?? version;
  // A concrete requested version that is absent (removed/unpublished) must not
  // silently fall back to latest — that would score the wrong bytes and let a
  // blocklisted-but-removed version slip through.
  const requestedVersionMissing = version !== "latest" && !tags[version] && !pack.versions[resolved];
  if (!pack.versions[resolved]) resolved = tags.latest ?? ordered.at(-1) ?? version;
  const vd = pack.versions[resolved];
  if (!vd) return { name, version, existsOnRegistry: false, versions: ordered, maintainers: [] };

  const idx = ordered.indexOf(resolved);
  const prev = idx > 0 ? ordered[idx - 1] : undefined;
  const prevData = prev ? pack.versions[prev] : undefined;

  const publishedAt = time[resolved];
  const ageDays = publishedAt ? Math.max(0, (Date.now() - Date.parse(publishedAt)) / 86_400_000) : undefined;
  const weekly = await getJson<{ downloads?: number }>(`${downloadsBase()}/${encodeName(name)}`, 5_000);

  const curEmail = vd._npmUser?.email;
  const prevEmail = prevData?._npmUser?.email;

  return {
    name,
    version: resolved,
    existsOnRegistry: true,
    requestedVersionMissing,
    versions: ordered,
    previousVersion: prev,
    publishedAt,
    ageDays,
    maintainers: names(vd.maintainers ?? pack.maintainers),
    previousMaintainers: prevData ? names(prevData.maintainers ?? pack.maintainers) : undefined,
    maintainerEmailChanged: Boolean(curEmail && prevEmail && curEmail !== prevEmail),
    hasProvenance: Boolean(vd.dist?.attestations),
    previousHadProvenance: prevData ? Boolean(prevData.dist?.attestations) : undefined,
    weeklyDownloads: typeof weekly?.downloads === "number" ? weekly.downloads : undefined,
    deprecated: Boolean(vd.deprecated),
    tarballUrl: vd.dist?.tarball,
    integrity: vd.dist?.integrity,
    previousTarballUrl: prevData?.dist?.tarball,
    scripts: vd.scripts,
    previousScripts: prevData?.scripts,
  };
}

/** Fetch a tarball as bytes (ArrayBuffer-backed, ready for gunzip). */
export async function fetchTarball(url: string, timeoutMs = 20_000): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
