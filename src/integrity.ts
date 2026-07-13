export type SriAlgo = "sha512" | "sha256" | "sha384" | "sha1";

export function computeIntegrity(data: Uint8Array | ArrayBuffer, algo: SriAlgo = "sha512"): string {
  const hasher = new Bun.CryptoHasher(algo);
  hasher.update(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
  const digest = hasher.digest();
  return `${algo}-${digest.toString("base64")}`;
}

export function parseIntegrity(integrity: string): { algo: SriAlgo; base64: string } | null {
  const dash = integrity.indexOf("-");
  if (dash === -1) return null;
  const algo = integrity.slice(0, dash) as SriAlgo;
  const base64 = integrity.slice(dash + 1);
  if (!["sha512", "sha256", "sha384", "sha1"].includes(algo)) return null;
  return { algo, base64 };
}

export function verifyIntegrity(data: Uint8Array | ArrayBuffer, expected: string): boolean {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  for (const one of expected.trim().split(/\s+/)) {
    const parsed = parseIntegrity(one);
    if (!parsed) continue;
    if (computeIntegrity(bytes, parsed.algo) === one) return true;
  }
  return false;
}

export class IntegrityError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "IntegrityError";
  }
}

export function assertIntegrity(data: Uint8Array | ArrayBuffer, expected: string): void {
  if (!verifyIntegrity(data, expected)) {
    throw new IntegrityError(`integrity mismatch: expected ${expected}`);
  }
}
