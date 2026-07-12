import type { PackageMeta, Signal } from "../types.js";
import { type FetchJsonOptions, fetchJson } from "../utils/http.js";

async function tryFetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T | undefined> {
  try {
    return await fetchJson<T>(url, { timeoutMs: 5_000, ...opts });
  } catch {
    return undefined;
  }
}

async function checkOsv(meta: PackageMeta): Promise<Signal[]> {
  const data = await tryFetchJson<{ vulns?: Array<{ id: string; summary?: string }> }>(
    "https://api.osv.dev/v1/query",
    {
      method: "POST",
      body: {
        version: meta.version,
        package: { name: meta.name, ecosystem: "npm" },
      },
    },
  );
  if (!data?.vulns?.length) return [];
  const ids = data.vulns.map((v) => v.id).slice(0, 5);
  return [
    {
      flag: "known_vulnerability",
      evidence: `${data.vulns.length} known vulnerability advisory(ies): ${ids.join(", ")}`,
      weight: Math.min(4, 1.5 + data.vulns.length),
    },
  ];
}

async function checkDepsDev(meta: PackageMeta): Promise<Signal[]> {
  const encoded = encodeURIComponent(meta.name);
  const data = await tryFetchJson<{ licenses?: string[] }>(
    `https://api.deps.dev/v3/systems/npm/packages/${encoded}/versions/${encodeURIComponent(meta.version)}`,
  );
  const licenses = data?.licenses ?? [];
  const copyleft = licenses.filter((l) => /GPL|AGPL|LGPL/i.test(l));
  if (!copyleft.length) return [];
  return [
    {
      flag: "license_copyleft",
      evidence: `copyleft license present: ${copyleft.join(", ")} (may impose obligations on your project)`,
      weight: 0.5,
    },
  ];
}

export async function enrich(meta: PackageMeta): Promise<Signal[]> {
  const results = await Promise.allSettled([checkOsv(meta), checkDepsDev(meta)]);
  const signals: Signal[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") signals.push(...r.value);
  }
  return signals;
}
