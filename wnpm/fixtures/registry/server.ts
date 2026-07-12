/**
 * Mini npm registry over Bun.serve — serves fixture packuments, tarballs, and
 * download points so the whole install path runs offline (no Docker, no network,
 * no live-malicious packages). Unknown package names 404, which the engine reads
 * as "does not exist" = slopsquat.
 *
 * Point the CLI at it with:
 *   WARDEN_REGISTRY=<url> WARDEN_DOWNLOADS=<url>/downloads
 */

import { materialize, FIXTURES, type FixturePackage } from "./fixtures.ts";

export interface MiniRegistry {
  url: string;
  downloadsUrl: string;
  stop: () => void;
}

export interface MiniRegistryOptions {
  /** Extra fixture packages to serve (in addition to the demo FIXTURES). */
  fixtures?: FixturePackage[];
  /** When true, serve ONLY `fixtures` (skip the demo FIXTURES). Prevents demo
   * packages (chalk/lodahs/...) from shadowing real ones when proxying. */
  only?: boolean;
  /** When true, packages/downloads not in fixtures are proxied to real npm.
   * Lets one run cover both crafted attacks and real packages. Test-only. */
  proxy?: boolean;
}

const REAL_REGISTRY = "https://registry.npmjs.org";
const REAL_DOWNLOADS = "https://api.npmjs.org/downloads/point/last-week";

export function startMiniRegistry(port = 0, opts: MiniRegistryOptions = {}): MiniRegistry {
  const packages = opts.only ? (opts.fixtures ?? []) : [...FIXTURES, ...(opts.fixtures ?? [])];
  const server = Bun.serve({
    port,
    async fetch(req) {
      const base = `http://localhost:${server.port}`;
      const { packuments, tarballs, downloads } = materialize(base, packages);
      const path = decodeURIComponent(new URL(req.url).pathname);

      // Download point: /downloads/point/last-week/:name
      const dl = path.match(/^\/downloads\/point\/last-week\/(.+)$/);
      if (dl) {
        const name = dl[1]!;
        if (downloads[name] !== undefined) return Response.json({ downloads: downloads[name], package: name });
        if (opts.proxy) return proxyTo(`${REAL_DOWNLOADS}/${encodeName(name)}`);
        return new Response("{}", { status: 404 });
      }

      if (tarballs[path]) {
        return new Response(tarballs[path], { headers: { "content-type": "application/octet-stream" } });
      }

      // Packument: /:name
      const name = path.replace(/^\//, "");
      if (packuments[name]) return Response.json(packuments[name]);
      if (opts.proxy && name) return proxyTo(`${REAL_REGISTRY}/${encodeName(name)}`);

      return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    },
  });
  const url = `http://localhost:${server.port}`;
  return { url, downloadsUrl: `${url}/downloads/point/last-week`, stop: () => server.stop(true) };
}

function encodeName(name: string): string {
  return name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
}

async function proxyTo(url: string): Promise<Response> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    return new Response(res.body, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
  } catch {
    return new Response("{}", { status: 502 });
  }
}

/** Standalone entry (`bun fixtures/registry/server.ts`) for manual demo poking. */
export function main(port = 4873, write: (s: string) => unknown = process.stderr.write.bind(process.stderr)): MiniRegistry {
  const reg = startMiniRegistry(port);
  write(`mini-registry on ${reg.url}\n`);
  write(`  WARDEN_REGISTRY=${reg.url} WARDEN_DOWNLOADS=${reg.downloadsUrl} wnpx lodahs --json\n`);
  return reg;
}

if (import.meta.main) main();
