import type { PackageMeta } from "./types.js";
import { fetchJson } from "./utils/http.js";
import { maxSatisfying } from "./utils/semver.js";

const registryBase = () => process.env.WARDEN_REGISTRY ?? "https://registry.npmjs.org";
const downloadsBase = () =>
  process.env.WARDEN_DOWNLOADS ?? "https://api.npmjs.org/downloads/point/last-week";

interface Packument {
  name: string;
  "dist-tags"?: Record<string, string>;
  time?: Record<string, string>;
  versions?: Record<string, PackumentVersion>;
  maintainers?: Array<{ name?: string } | string>;
  repository?: { url?: string } | string;
}

interface PackumentVersion {
  version: string;
  scripts?: Record<string, string>;
  deprecated?: string;
  dist?: { tarball?: string };
  maintainers?: Array<{ name?: string } | string>;
  _npmUser?: { name?: string };
  repository?: { url?: string } | string;
}

function normalizeMaintainers(list: Array<{ name?: string } | string> | undefined): string[] {
  if (!list) return [];
  return list
    .map((m) => (typeof m === "string" ? m.split("<")[0]?.trim() : m.name))
    .filter((n): n is string => Boolean(n));
}

function repoUrl(repo: { url?: string } | string | undefined): string | undefined {
  if (!repo) return undefined;
  const raw = typeof repo === "string" ? repo : repo.url;
  if (!raw) return undefined;
  return raw
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git$/, "");
}

function orderVersions(pack: Packument): string[] {
  const versions = Object.keys(pack.versions ?? {});
  const time = pack.time ?? {};
  return versions.sort((a, b) => {
    const ta = time[a] ? Date.parse(time[a]) : 0;
    const tb = time[b] ? Date.parse(time[b]) : 0;
    return ta - tb;
  });
}

async function fetchWeeklyDownloads(name: string): Promise<number | undefined> {
  try {
    const data = await fetchJson<{ downloads?: number }>(`${downloadsBase()}/${name}`, {
      timeoutMs: 5_000,
    });
    return typeof data.downloads === "number" ? data.downloads : undefined;
  } catch {
    return undefined;
  }
}

function encodeName(name: string): string {
  return name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
}

export async function resolvePackage(name: string, version = "latest"): Promise<PackageMeta> {
  const pack = await fetchJson<Packument>(`${registryBase()}/${encodeName(name)}`);
  const distTags = pack["dist-tags"] ?? {};
  const ordered = orderVersions(pack);

  let resolved = version;
  if (distTags[version]) resolved = distTags[version];
  if (!pack.versions?.[resolved]) {
    if (version === "latest" && ordered.length) {
      resolved = distTags.latest ?? ordered[ordered.length - 1];
    } else {
      const satisfied = maxSatisfying(ordered, version);
      if (!satisfied) throw new Error(`${name} has no version matching "${version}"`);
      resolved = satisfied;
    }
  }

  const versionData = pack.versions?.[resolved];
  if (!versionData) {
    throw new Error(`${name}@${resolved} not found in packument`);
  }

  const idx = ordered.indexOf(resolved);
  const previousVersion = idx > 0 ? ordered[idx - 1] : undefined;
  const previousData = previousVersion ? pack.versions?.[previousVersion] : undefined;

  const publishedAt = pack.time?.[resolved];
  const ageDays = publishedAt ? (Date.now() - Date.parse(publishedAt)) / 86_400_000 : undefined;

  const maintainers = normalizeMaintainers(versionData.maintainers ?? pack.maintainers);
  const previousMaintainers = previousData
    ? normalizeMaintainers(previousData.maintainers ?? pack.maintainers)
    : undefined;

  const weeklyDownloads = await fetchWeeklyDownloads(name);

  return {
    name,
    version: resolved,
    versions: ordered,
    previousVersion,
    publishedAt,
    ageDays: ageDays === undefined ? undefined : Math.max(0, ageDays),
    maintainers,
    previousMaintainers,
    tarballUrl: versionData.dist?.tarball,
    previousTarballUrl: previousData?.dist?.tarball,
    weeklyDownloads,
    deprecated: versionData.deprecated ?? false,
    repositoryUrl: repoUrl(versionData.repository ?? pack.repository),
    scripts: versionData.scripts,
    previousScripts: previousData?.scripts,
  };
}
