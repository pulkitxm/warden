# Codebase detection and onboarding

`warden detect` classifies the repo; `warden init` onboards it. Everything else consumes the detection manifest.

Part of the [product plan](system-integration.md).

## `warden detect`

Everything warden generates is only as good as its picture of the repo, so detection is its own verb with robust, evidence-based logic. No guessing; every classification cites the file or dependency that proves it.

Three layers, each feeding the next:

1. **Workspace topology**: `turbo.json`, `nx.json`, `pnpm-workspace.yaml`, `lerna.json`, `package.json` `workspaces` field. Result: single package, or a monorepo with N member packages, plus which orchestrator runs it.
2. **Per-package classification**: for every member package, read its `package.json` and config files and classify:
   - framework: `next` dep + `next.config.*` means Next.js; `express` dep means Express service; same pattern for Nest, Fastify, Remix, Astro, Vite and React SPA, plain Node library, CLI (`bin` field)
   - language and tooling: `tsconfig.json`, test runner (bun test, vitest, jest), formatter and linter (biome, eslint, prettier)
   - role: app, service, shared library, tooling package
3. **Runtime and package manager**: lockfiles (`bun.lock`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`), `engines`, `.nvmrc`, `packageManager` field.

Output is a detection manifest (`warden detect --json`): the workspace graph with each package's framework, role, tooling, and the evidence for each call. Permutations fall out naturally: a Turborepo containing two Express services and a Next.js app is just three classified members under one `turbo` topology.

The manifest is the single input every other feature consumes: `warden ci` scopes checks to affected packages through the detected orchestrator, policies apply per package role (a stricter dependency policy for services than for tooling), and slop signals know which entry points are real (Next.js file-system routes are not "unused exports").

```
$ warden detect

turbo monorepo · pnpm@9.4 · node >=20 · 3 packages

  apps/web         Next.js 15    app       ts, biome, vitest
  apps/api         Express 5     service   ts, eslint, jest
  packages/shared  library       library   ts, no test runner

evidence:
  topology   turbo.json, pnpm-workspace.yaml
  apps/web   next in dependencies, next.config.ts
  apps/api   express in dependencies, src/server.ts binds a port
  shared     no bin, no framework deps, imported by both apps
```

## `warden init`

One command to onboard a repo, built on the detection manifest:

- Runs `warden detect` and shows the classified workspace graph for confirmation.
- Writes `warden.config.json` with per-package defaults tailored to what was detected: framework-aware ignore patterns, the right format command per package, dependency policies scaled to package role.
- Suggests agent-facing improvements for that specific codebase: which checks give agents the fastest feedback, per-package `warden ci` scoping, and gaps worth closing (a package with no test runner, a service with no lockfile discipline).
- Offers to add `.github/workflows/warden.yml` (checkout, install warden, `warden ci`, scoped to affected packages on monorepos).
- Offers to install the git pre-push hook.
- Asks which policies to enable (comments, format, dependency rules) and records the choices in the config.
- Offers to write a warden section into `CLAUDE.md`/`AGENTS.md` at the root and per package, so agents learn the policies and feedback commands before CI enforces them.

```
$ warden init

detected: turbo monorepo, 3 packages (run `warden detect` for details)
proceed with this layout? [Y/n] y

enable policies?
  comments (forbid narrative comments)        [y/N] y
  format (delegate to biome/eslint per package) [Y/n] y
  dependencies (license allowlist, min age)     [Y/n] y

wrote warden.config.json               (root defaults)
wrote apps/api/warden.config.json      (service overrides: stricter dependency policy)
wrote .github/workflows/warden.yml     (warden ci, scoped to affected packages)
installed pre-push hook                (.githooks/pre-push)
updated CLAUDE.md + 3 package files    (warden policies and feedback commands)

suggestions for this codebase:
  packages/shared has no test runner; agents get no feedback on changes there
  apps/api pins no engines field; lockfile discipline is weaker without it

run `warden ci` locally to see the first report
```
