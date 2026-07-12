export const POPULAR_PACKAGES: Array<{ name: string; weeklyDownloads: number }> = [
  { name: "react", weeklyDownloads: 25_000_000 },
  { name: "lodash", weeklyDownloads: 50_000_000 },
  { name: "axios", weeklyDownloads: 45_000_000 },
  { name: "chalk", weeklyDownloads: 300_000_000 },
  { name: "debug", weeklyDownloads: 250_000_000 },
  { name: "express", weeklyDownloads: 30_000_000 },
  { name: "commander", weeklyDownloads: 150_000_000 },
  { name: "is-odd", weeklyDownloads: 2_000_000 },
  { name: "is-even", weeklyDownloads: 1_000_000 },
  { name: "chokidar", weeklyDownloads: 60_000_000 },
  { name: "dotenv", weeklyDownloads: 40_000_000 },
  { name: "colors", weeklyDownloads: 25_000_000 },
  { name: "cross-env", weeklyDownloads: 12_000_000 },
  { name: "node-fetch", weeklyDownloads: 45_000_000 },
  { name: "typescript", weeklyDownloads: 70_000_000 },
  { name: "webpack", weeklyDownloads: 30_000_000 },
  { name: "next", weeklyDownloads: 8_000_000 },
  { name: "vue", weeklyDownloads: 5_000_000 },
  { name: "eslint", weeklyDownloads: 40_000_000 },
  { name: "moment", weeklyDownloads: 20_000_000 },
];

export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

export interface TyposquatMatch {
  target: string;
  distance: number;
  targetWeeklyDownloads: number;
}

export function findTyposquat(name: string, maxDistance = 2): TyposquatMatch | null {
  const bare = name.replace(/^@[^/]+\//, "");
  if (bare.length < 3) return null;

  let best: TyposquatMatch | null = null;
  for (const pkg of POPULAR_PACKAGES) {
    if (bare === pkg.name) return null;
    const distance = editDistance(bare, pkg.name);
    if (
      distance > 0 &&
      distance <= maxDistance &&
      Math.abs(bare.length - pkg.name.length) <= maxDistance &&
      (!best || distance < best.distance)
    ) {
      best = {
        target: pkg.name,
        distance,
        targetWeeklyDownloads: pkg.weeklyDownloads,
      };
    }
  }
  return best;
}
