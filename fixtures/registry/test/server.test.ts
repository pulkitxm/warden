/** Mini-registry branches the engine tests never hit: 404s without proxy,
 * proxy passthrough (upstream fetch stubbed — no live npm), and standalone main. */

import { test, expect } from "bun:test";
import { startMiniRegistry, main } from "../server.ts";

const realFetch = globalThis.fetch.bind(globalThis);

test("non-proxy mode 404s unknown downloads and packuments", async () => {
  const reg = startMiniRegistry(0, { only: true, fixtures: [] });
  try {
    expect((await realFetch(`${reg.url}/downloads/point/last-week/nope`)).status).toBe(404);
    expect((await realFetch(`${reg.url}/nope`)).status).toBe(404);
  } finally {
    reg.stop();
  }
});

test("proxy mode forwards unknown names upstream; upstream failure -> 502", async () => {
  // Stub the global fetch the server uses for upstream calls; pass local
  // requests through so the test can still reach the mini-registry itself.
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://registry.npmjs.org/")) {
      if (url.includes("exploding")) throw new Error("upstream down");
      return Response.json({ name: "upstream-pkg", fetched: url });
    }
    if (url.startsWith("https://api.npmjs.org/")) return Response.json({ downloads: 123 });
    return realFetch(input, init);
  }) as typeof fetch;

  const reg = startMiniRegistry(0, { proxy: true, only: true, fixtures: [] });
  try {
    // Packument proxy — plain and scoped names exercise both encodeName arms.
    const plain = (await (await realFetch(`${reg.url}/upstream-pkg`)).json()) as { name: string; fetched: string };
    expect(plain.name).toBe("upstream-pkg");
    expect(plain.fetched).toBe("https://registry.npmjs.org/upstream-pkg");
    const scoped = (await (await realFetch(`${reg.url}/@scope/pkg`)).json()) as { fetched: string };
    expect(scoped.fetched).toBe(`https://registry.npmjs.org/@${encodeURIComponent("scope/pkg")}`);

    // Downloads proxy.
    const dl = (await (await realFetch(`${reg.url}/downloads/point/last-week/upstream-pkg`)).json()) as { downloads: number };
    expect(dl.downloads).toBe(123);

    // Upstream error is contained as a 502, never thrown at the client.
    expect((await realFetch(`${reg.url}/exploding-pkg`)).status).toBe(502);
  } finally {
    globalThis.fetch = realFetch as typeof fetch;
    reg.stop();
  }
});

test("standalone main() starts a registry and prints connection hints", () => {
  const lines: string[] = [];
  const reg = main(0, (s) => lines.push(s));
  try {
    expect(reg.url).toStartWith("http://localhost:");
    expect(lines.join("")).toContain(`mini-registry on ${reg.url}`);
    expect(lines.join("")).toContain("WARDEN_REGISTRY=");
  } finally {
    reg.stop();
  }
});
