/**
 * Seed of popular npm package names with approximate weekly downloads.
 *
 * MVP seed. A committed top-10k snapshot (npm-rank / all-the-package-names)
 * drops in here as JSON without touching the algorithm — the BK-tree and
 * normalization are size-agnostic. Kept small enough to eyeball, large enough
 * to make the typosquat demo real.
 */
export interface PopularPackage {
  name: string;
  weekly: number;
}

export const POPULAR: PopularPackage[] = [
  { name: "react", weekly: 25_000_000 },
  { name: "react-dom", weekly: 24_000_000 },
  { name: "lodash", weekly: 300_000_000 },
  { name: "axios", weekly: 100_000_000 },
  { name: "chalk", weekly: 300_000_000 },
  { name: "debug", weekly: 358_000_000 },
  { name: "express", weekly: 30_000_000 },
  { name: "commander", weekly: 150_000_000 },
  { name: "is-odd", weekly: 2_000_000 },
  { name: "is-even", weekly: 1_000_000 },
  { name: "chokidar", weekly: 60_000_000 },
  { name: "dotenv", weekly: 40_000_000 },
  { name: "colors", weekly: 25_000_000 },
  { name: "classnames", weekly: 12_000_000 },
  { name: "cross-env", weekly: 12_000_000 },
  { name: "node-fetch", weekly: 45_000_000 },
  { name: "typescript", weekly: 70_000_000 },
  { name: "webpack", weekly: 30_000_000 },
  { name: "next", weekly: 8_000_000 },
  { name: "vue", weekly: 5_000_000 },
  { name: "eslint", weekly: 40_000_000 },
  { name: "moment", weekly: 20_000_000 },
  { name: "ansi-styles", weekly: 300_000_000 },
  { name: "jest", weekly: 30_000_000 },
  { name: "rimraf", weekly: 60_000_000 },
  { name: "glob", weekly: 90_000_000 },
  { name: "uuid", weekly: 130_000_000 },
  { name: "semver", weekly: 200_000_000 },
  { name: "yargs", weekly: 80_000_000 },
  { name: "prettier", weekly: 30_000_000 },
];
