import {
  FIXTURES,
  type FixturePackage,
  type FixtureVuln,
  materialize,
  osvRecord,
  VULN_FIXTURES,
} from "./fixtures.ts";

export interface MiniRegistry {
  url: string;
  downloadsUrl: string;
  stop: () => void;
}

export interface MiniRegistryOptions {
  fixtures?: FixturePackage[];
  vulns?: FixtureVuln[];
  only?: boolean;
  proxy?: boolean;
}

const REAL_REGISTRY = "https://registry.npmjs.org";
const REAL_DOWNLOADS = "https://api.npmjs.org/downloads/point/last-week";

export function startMiniRegistry(port = 0, opts: MiniRegistryOptions = {}): MiniRegistry {
  const packages = opts.only ? (opts.fixtures ?? []) : [...FIXTURES, ...(opts.fixtures ?? [])];
  const vulns = opts.only ? (opts.vulns ?? []) : [...VULN_FIXTURES, ...(opts.vulns ?? [])];
  const server = Bun.serve({
    port,
    async fetch(req) {
      const base = `http://localhost:${server.port}`;
      const { packuments, tarballs, downloads } = materialize(base, packages);
      const path = decodeURIComponent(new URL(req.url).pathname);

      if (req.method === "POST" && path === "/v1/query") {
        const body = (await req.json().catch(() => ({}))) as { package?: { name?: string } };
        const name = body.package?.name;
        const hits = vulns.filter((v) => v.package === name).map(osvRecord);
        return Response.json(hits.length ? { vulns: hits } : {});
      }

      const dl = path.match(/^\/downloads\/point\/last-week\/(.+)$/);
      if (dl) {
        const name = dl[1]!;
        if (downloads[name] !== undefined)
          return Response.json({ downloads: downloads[name], package: name });
        if (opts.proxy) return proxyTo(`${REAL_DOWNLOADS}/${encodeName(name)}`);
        return new Response("{}", { status: 404 });
      }

      if (tarballs[path]) {
        return new Response(tarballs[path], {
          headers: { "content-type": "application/octet-stream" },
        });
      }

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
    return new Response(res.body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return new Response("{}", { status: 502 });
  }
}

export function main(
  port = 4873,
  write: (s: string) => unknown = process.stderr.write.bind(process.stderr),
): MiniRegistry {
  const reg = startMiniRegistry(port);
  write(`mini-registry on ${reg.url}\n`);
  write(
    `  WNPM_REGISTRY=${reg.url} WNPM_DOWNLOADS=${reg.downloadsUrl} WNPM_OSV=${reg.url} wnpx lodahs --json\n`,
  );
  return reg;
}

if (import.meta.main) main();
