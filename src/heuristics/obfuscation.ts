import type { TarballFile } from "../types.js";

export interface ObfuscationResult {
  score: number;
  path?: string;
  reason?: string;
}

export function entropy(s: string): number {
  if (!s.length) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function scoreFile(content: string): { score: number; reason: string } {
  const lines = content.split("\n");
  const longest = lines.reduce((max, l) => Math.max(max, l.length), 0);
  const avgLineLen = content.length / Math.max(1, lines.length);

  let score = 0;
  const reasons: string[] = [];

  if (longest > 2000) {
    score += 0.4;
    reasons.push(`line of ${longest} chars`);
  } else if (avgLineLen > 400) {
    score += 0.25;
    reasons.push("very long average line length");
  }

  const blob = content.match(/[A-Za-z0-9+/]{200,}={0,2}/);
  if (blob) {
    score += 0.35;
    reasons.push("large encoded blob");
  }
  const hex = content.match(/(\\x[0-9a-fA-F]{2}){20,}/);
  if (hex) {
    score += 0.35;
    reasons.push("long hex-escape sequence");
  }

  const h = entropy(content.slice(0, 20_000));
  if (h > 5.2 && longest > 500) {
    score += 0.25;
    reasons.push(`high entropy (${h.toFixed(1)} bits/char)`);
  }

  return { score: Math.min(1, score), reason: reasons.join(", ") };
}

export function detectObfuscation(files: TarballFile[]): ObfuscationResult {
  let worst: ObfuscationResult = { score: 0 };
  for (const f of files) {
    if (!f.content || f.binary) continue;
    if (!/\.(js|cjs|mjs|jsx|ts|cts|mts|tsx)$/i.test(f.path)) continue;
    const { score, reason } = scoreFile(f.content);
    if (score > worst.score) worst = { score, path: f.path, reason };
  }
  return worst;
}
