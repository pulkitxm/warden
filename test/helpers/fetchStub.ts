export type Route = (url: string, init?: RequestInit) => Response | undefined;

const realFetch = globalThis.fetch;

export function stubFetch(route: Route): () => void {
  const stub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const res = route(url, init);
    if (!res) throw new Error(`unstubbed fetch: ${url}`);
    return res;
  };
  globalThis.fetch = stub as typeof fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function bytesResponse(bytes: Uint8Array, status = 200): Response {
  const copy = new Uint8Array(bytes);
  return new Response(copy.buffer as ArrayBuffer, { status });
}
