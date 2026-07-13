# WNPM repository cleanup design

## Goal

Make WNPM the repository's only product and implementation. Warden remains only the internal team namespace used by imports such as `@warden/schema` where retaining it avoids a cosmetic rename.

## Repository structure

Promote the newer `wnpm/` implementation to the repository root and consolidate its internal workspaces into one Bun package:

```text
src/
  bin/
  cli/
  heuristics/
  intel/
  engine.ts
  registry.ts
  tar.ts
  integrity.ts
  diff.ts
  score.ts
  cache.ts
  llm.ts
  schema.ts
test/
fixtures/
demo/
scripts/
research/
docs/
.githooks/
.github/workflows/
```

The source modules keep their existing responsibilities. Internal workspace package manifests and alias boundaries disappear because no module is independently published. Tests mirror the retained source modules.

## Deletions

Delete the older root Warden engine, CLI, tests, Claude Code adapter, duplicate configuration, and obsolete documentation. Delete stale plans, generated task reports, and superseded product concepts. Keep:

- offline registry fixtures required by tests;
- one end-to-end demo and its agent policy example;
- verified security citations and concise research supporting detection rules;
- current CLI, architecture, detection, and development documentation.

All user-facing names, output, documentation, and binary names use WNPM. Existing `@warden/*` internal import names may remain where changing them adds no product value.

## CI and hooks

`make ci` is the single CI entry point. It runs the commands required to validate the promoted WNPM implementation: frozen dependency installation, tests, type-checking, standalone binary builds, and CLI smoke tests.

GitHub Actions invokes `make ci` instead of duplicating the command list. A tracked `.githooks/pre-push` invokes `make ci`. `make install` configures the repository to use `.githooks` through Git's native `core.hooksPath`; no hook dependency is added.

## Behavior and failure handling

The cleanup must preserve the newer implementation's verdict engine, `wnpm` and `wnpx` interfaces, JSON schema output, integrity verification, cache, blocklists, offline registry, and tests. CI and pre-push stop on the first failed command and return its nonzero status.

## Verification

Completion requires `make ci` to pass from the repository root and confirmation that the pre-push hook delegates to it. Searches must find no remaining user-facing Warden product naming or imports from deleted legacy code.
