/**
 * Mini npm registry over Bun.serve — serves fixture packuments, tarballs, and
 * download points so the whole install path runs offline (no Docker, no network,
 * no live-malicious packages). Unknown package names 404, which the engine reads
 * as "does not exist" = slopsquat.
 *
 * Point the CLI at it with:
 *   WARDEN_REGISTRY=<url> WARDEN_DOWNLOADS=<url>/downloads
 */

import { materialize } from "./fixtures.ts";

export interface MiniRegistry {
  url: string;
  downloadsUrl: string;
  stop: () => void;
}

export function startMiniRegistry(port = 0): MiniRegistry {
  // Bind first to learn the port, then materialize with the real base URL.
  const server = Bun.serve({
    port,
    fetch(req) {
      const base = `http://localhost:${server.port}`;
      const { packuments, tarballs, downloads } = materialize(base);
      const path = decodeURIComponent(new URL(req.url).pathname);

      // Download point: /downloads/point/last-week/:name
      const dl = path.match(/^\/downloads\/point\/last-week\/(.+)$/);
      if (dl) {
        const name = dl[1]!;
        if (downloads[name] === undefined) return new Response("{}", { status: 404 });
        return Response.json({ downloads: downloads[name], package: name });
      }

      // Tarball.
      if (tarballs[path]) {
        return new Response(tarballs[path], { headers: { "content-type": "application/octet-stream" } });
      }

      // Packument: /:name  (scoped names arrive percent-decoded here).
      const name = path.replace(/^\//, "");
      if (packuments[name]) return Response.json(packuments[name]);

      return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    },
  });
  const url = `http://localhost:${server.port}`;
  return { url, downloadsUrl: `${url}/downloads/point/last-week`, stop: () => server.stop(true) };
}

// Run standalone: `bun fixtures/registry/server.ts` for manual demo poking.
if (import.meta.main) {
  const reg = startMiniRegistry(4873);
  process.stderr.write(`mini-registry on ${reg.url}\n`);
  process.stderr.write(`  WARDEN_REGISTRY=${reg.url} WARDEN_DOWNLOADS=${reg.downloadsUrl} wnpx lodahs --json\n`);
}
