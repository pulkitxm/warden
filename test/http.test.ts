import { afterEach, describe, expect, it } from "bun:test";
import { fetchBuffer, fetchJson } from "../src/utils/http.js";
import { bytesResponse, jsonResponse, stubFetch } from "./helpers/fetchStub.js";

let restore = () => {};
afterEach(() => restore());

describe("fetchJson", () => {
  it("gets and parses JSON", async () => {
    restore = stubFetch((url) => (url.endsWith("/ok") ? jsonResponse({ a: 1 }) : undefined));
    expect(await fetchJson<{ a: number }>("https://x.test/ok")).toEqual({ a: 1 });
  });

  it("sends a JSON body with the right headers", async () => {
    let seen: RequestInit | undefined;
    restore = stubFetch((_url, init) => {
      seen = init;
      return jsonResponse({ ok: true });
    });
    await fetchJson("https://x.test/post", { method: "POST", body: { q: 2 } });
    expect(seen?.method).toBe("POST");
    expect(seen?.body).toBe('{"q":2}');
    const headers = (seen?.headers ?? {}) as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
  });

  it("throws on a non-2xx status", async () => {
    restore = stubFetch(() => jsonResponse({ error: "nope" }, 404));
    expect(fetchJson("https://x.test/missing")).rejects.toThrow("404");
  });
});

describe("fetchBuffer", () => {
  it("downloads bytes", async () => {
    restore = stubFetch(() => bytesResponse(new Uint8Array([1, 2, 3])));
    const buf = await fetchBuffer("https://x.test/t.tgz");
    expect([...buf]).toEqual([1, 2, 3]);
  });

  it("throws on a non-2xx status", async () => {
    restore = stubFetch(() => bytesResponse(new Uint8Array(), 500));
    expect(fetchBuffer("https://x.test/bad.tgz")).rejects.toThrow("500");
  });

  it("rejects a declared content-length over the cap", async () => {
    restore = stubFetch(
      () =>
        new Response(new Uint8Array(4).buffer as ArrayBuffer, {
          status: 200,
          headers: { "content-length": "999999999" },
        }),
    );
    expect(fetchBuffer("https://x.test/huge.tgz", { maxBytes: 1000 })).rejects.toThrow("cap");
  });

  it("rejects an actual body over the cap", async () => {
    restore = stubFetch(() => bytesResponse(new Uint8Array(2048)));
    expect(fetchBuffer("https://x.test/big.tgz", { maxBytes: 1024 })).rejects.toThrow("cap");
  });
});
