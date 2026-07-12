/**
 * Subresource Integrity (SRI) compute + verify.
 *
 * An SRI string is `<algo>-<base64(digest)>`. npm publishes `dist.integrity`
 * (usually `sha512-...`); it is our content-address cache key and our
 * tamper check. This replaces the `ssri` npm dependency with ~15 lines on
 * Bun's built-in hasher.
 */

export type SriAlgo = "sha512" | "sha256" | "sha384" | "sha1";

/** Compute an SRI string for the given bytes. Defaults to sha512 (npm's default). */
export function computeIntegrity(data: Uint8Array | ArrayBuffer, algo: SriAlgo = "sha512"): string {
  const hasher = new Bun.CryptoHasher(algo);
  hasher.update(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
  const digest = hasher.digest(); // Buffer
  return `${algo}-${digest.toString("base64")}`;
}

/** Parse an SRI string into its algorithm and base64 digest. */
export function parseIntegrity(integrity: string): { algo: SriAlgo; base64: string } | null {
  const dash = integrity.indexOf("-");
  if (dash === -1) return null;
  const algo = integrity.slice(0, dash) as SriAlgo;
  const base64 = integrity.slice(dash + 1);
  if (!["sha512", "sha256", "sha384", "sha1"].includes(algo)) return null;
  return { algo, base64 };
}

/**
 * Verify bytes against an expected SRI string (recomputes with the SRI's own
 * algorithm). npm may publish multiple space-separated integrity strings; any
 * match passes.
 */
export function verifyIntegrity(data: Uint8Array | ArrayBuffer, expected: string): boolean {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  for (const one of expected.trim().split(/\s+/)) {
    const parsed = parseIntegrity(one);
    if (!parsed) continue;
    if (computeIntegrity(bytes, parsed.algo) === one) return true;
  }
  return false;
}

// Explicit constructor: Bun's function coverage counts a synthesized one as never called.
export class IntegrityError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "IntegrityError";
  }
}

/** Throw unless bytes match the expected integrity. */
export function assertIntegrity(data: Uint8Array | ArrayBuffer, expected: string): void {
  if (!verifyIntegrity(data, expected)) {
    throw new IntegrityError(`integrity mismatch: expected ${expected}`);
  }
}
