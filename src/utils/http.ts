export const MAX_TARBALL_BYTES = 64 * 1024 * 1024;

export interface FetchJsonOptions {
  timeoutMs?: number;
  method?: string;
  body?: unknown;
}

export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const res = await fetch(url, {
    method,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    headers: opts.body
      ? { "content-type": "application/json", accept: "application/json" }
      : { accept: "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export async function fetchBuffer(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<Buffer> {
  const max = opts.maxBytes ?? MAX_TARBALL_BYTES;
  const res = await fetch(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000) });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > max) {
    throw new Error(`${url} declares ${declared} bytes, over the ${max}-byte cap`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max) {
    throw new Error(`${url} downloaded ${buf.length} bytes, over the ${max}-byte cap`);
  }
  return buf;
}
