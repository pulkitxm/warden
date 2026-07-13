import { expect, test } from "bun:test";
import { main, startMiniRegistry } from "../server.ts";

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

test("OSV endpoint tolerates malformed bodies and unknown packages", async () => {
  const reg = startMiniRegistry();
  try {
    const bad = await realFetch(`${reg.url}/v1/query`, { method: "POST", body: "not json" });
    expect(await bad.json()).toEqual({});
    const clean = await realFetch(`${reg.url}/v1/query`, {
      method: "POST",
      body: JSON.stringify({ package: { name: "left-pad" } }),
    });
    expect(await clean.json()).toEqual({});
  } finally {
    reg.stop();
  }
});

test("proxy mode forwards unknown names upstream; upstream failure -> 502", async () => {
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
    const plain = (await (await realFetch(`${reg.url}/upstream-pkg`)).json()) as {
      name: string;
      fetched: string;
    };
    expect(plain.name).toBe("upstream-pkg");
    expect(plain.fetched).toBe("https://registry.npmjs.org/upstream-pkg");
    const scoped = (await (await realFetch(`${reg.url}/@scope/pkg`)).json()) as { fetched: string };
    expect(scoped.fetched).toBe(`https://registry.npmjs.org/@${encodeURIComponent("scope/pkg")}`);

    const dl = (await (
      await realFetch(`${reg.url}/downloads/point/last-week/upstream-pkg`)
    ).json()) as { downloads: number };
    expect(dl.downloads).toBe(123);

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
    expect(lines.join("")).toContain("WNPM_REGISTRY=");
  } finally {
    reg.stop();
  }
});
