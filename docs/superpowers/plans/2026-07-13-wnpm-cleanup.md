# WNPM Repository Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the duplicate Warden/WNPM repository with one root-level WNPM package and one shared local/GitHub CI command.

**Architecture:** Promote the newer Bun implementation, preserve its module boundaries as ordinary `src/` files, and replace workspace aliases with relative imports. GitHub Actions and the native Git pre-push hook both delegate to `make ci`.

**Tech Stack:** Bun, TypeScript, Make, GitHub Actions, native Git hooks.

## Global Constraints

- WNPM is the only user-facing product name; Warden is only the team name.
- Preserve the newer implementation's verdict engine and `wnpm`/`wnpx` behavior.
- Add no hook, build, or runtime dependency unless already required by the promoted implementation.
- Keep offline fixtures, one end-to-end demo, verified citations, and concise maintained documentation.

---

### Task 1: Promote the WNPM implementation

**Files:**
- Replace: `package.json`, `bun.lock`, `bunfig.toml`, `tsconfig.json`
- Create: `src/bin/wnpm.ts`, `src/bin/wnpx.ts`, `src/cli/main.ts`, `src/cli/ui.ts`
- Create: `src/engine.ts`, `src/registry.ts`, `src/tar.ts`, `src/integrity.ts`, `src/diff.ts`, `src/score.ts`, `src/cache.ts`, `src/llm.ts`, `src/schema.ts`
- Create: `src/distance/index.ts`, `src/distance/popular.ts`, `src/heuristics/index.ts`, `src/heuristics/scan.ts`, `src/intel/index.ts`, `src/intel/data/blocklist.json`, `src/intel/data/hallucinated.json`
- Create: matching tests under `test/`
- Delete: legacy root implementation and `wnpm/apps`, `wnpm/packages`

**Interfaces:**
- Consumes: existing newer WNPM source and tests under `wnpm/`.
- Produces: `runWnpm(argv)` and `runWnpx(argv)` in `src/cli/main.ts`; `checkPackage(spec)` in `src/engine.ts`; standalone `dist/wnpm` and `dist/wnpx` binaries.

- [ ] **Step 1: Record the existing newer-suite baseline**

Run: `cd wnpm && bun test && bun run typecheck && bun run build`

Expected: all tests pass, type-check succeeds, and both binaries build.

- [ ] **Step 2: Move the newer source and tests to the root structure**

Use `git mv` for retained files, rename `sri` to `integrity`, and remove workspace package manifests. Rewrite `@warden/*` imports to relative imports ending in `.ts`.

- [ ] **Step 3: Replace root package configuration**

Use one package named `wnpm` with these scripts:

```json
{
  "build": "bun build ./src/bin/wnpm.ts --compile --outfile dist/wnpm && bun build ./src/bin/wnpx.ts --compile --outfile dist/wnpx",
  "test": "bun test",
  "typecheck": "tsc -p tsconfig.json --noEmit"
}
```

Set TypeScript's `include` to `src`, `test`, `fixtures`, `demo`, and `scripts`; remove workspace path aliases.

- [ ] **Step 4: Run the promoted suite**

Run: `bun install && bun test && bun run typecheck && bun run build`

Expected: the same suite passes from the repository root and both root binaries build.

- [ ] **Step 5: Commit**

```sh
git add -A
git commit -m "refactor: promote WNPM as the only implementation"
```

### Task 2: Remove obsolete repository material and rename the product

**Files:**
- Replace: `README.md`
- Create: `docs/architecture.md`, `docs/cli.md`, `docs/development.md`, `docs/detection.md`
- Move: `wnpm/fixtures` to `fixtures`, `wnpm/demo` to `demo`, retained scripts to `scripts`, and verified citations to `research/citations.md`
- Delete: `adapters/`, `task-tracker/`, remaining `wnpm/`, obsolete product concepts, generated reports, and superseded docs

**Interfaces:**
- Consumes: the root layout from Task 1.
- Produces: current WNPM-only documentation and retained offline validation assets.

- [ ] **Step 1: Move retained fixtures, demo, scripts, and citations**

Keep the offline registry and its tests, the agent simulation, the vulnerability/generalization scripts, and verified citation material.

- [ ] **Step 2: Delete superseded material**

Delete the old Claude Code Warden adapter, legacy source/tests/configuration, task trackers, generated vulnerability reports, and duplicate concept documents.

- [ ] **Step 3: Rewrite maintained documentation**

Document only the WNPM CLI, current architecture, detection behavior, development commands, offline demo, and limitations. User-facing examples must use `wnpm` or `wnpx`.

- [ ] **Step 4: Verify naming and references**

Run: `rg -n '\bWarden\b|\bwarden\b|wnpm/' README.md docs demo src test fixtures scripts research package.json Makefile .github || true`

Expected: no user-facing Warden product naming and no stale nested `wnpm/` paths; internal historical citations may mention the team only when necessary.

- [ ] **Step 5: Run tests and commit**

```sh
bun test
git add -A
git commit -m "docs: make WNPM the sole product"
```

### Task 3: Make CI local and enforce it before push

**Files:**
- Modify: `Makefile`
- Replace: `.github/workflows/ci.yml`
- Create: `.githooks/pre-push`
- Modify: `README.md`, `docs/development.md`

**Interfaces:**
- Consumes: package scripts and binaries from Task 1.
- Produces: `make ci`, `make install`, and an executable native pre-push hook.

- [ ] **Step 1: Add a failing CI contract check**

Run before editing: `make ci`

Expected: failure with `No rule to make target 'ci'`.

- [ ] **Step 2: Implement the Make targets**

Add:

```make
.PHONY: install ci
install:
	bun install
	git config core.hooksPath .githooks

ci:
	bun install --frozen-lockfile
	bun test
	bun run typecheck
	bun run build
	./dist/wnpm --help
	./dist/wnpx --schema
```

- [ ] **Step 3: Add the native pre-push hook**

Create executable `.githooks/pre-push`:

```sh
#!/bin/sh
exec make ci
```

- [ ] **Step 4: Deduplicate GitHub Actions**

Keep checkout and Bun setup, then run exactly:

```yaml
- run: make ci
```

- [ ] **Step 5: Activate and verify hooks**

Run: `make install && test "$(git config core.hooksPath)" = .githooks && test -x .githooks/pre-push`

Expected: exit 0.

- [ ] **Step 6: Run the complete local workflow**

Run: `make ci`

Expected: frozen install, tests, type-check, build, and both smoke tests pass.

- [ ] **Step 7: Commit**

```sh
git add Makefile .github/workflows/ci.yml .githooks/pre-push README.md docs/development.md
git commit -m "ci: run the full workflow before push"
```

### Task 4: Final repository verification

**Files:**
- Verify all retained files; modify only defects exposed by checks.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: a clean, tested WNPM repository.

- [ ] **Step 1: Check the final tree and diff**

Run: `git status --short && git diff --check && find . -maxdepth 3 -type f -not -path './.git/*' -not -path './node_modules/*' | sort`

Expected: no whitespace errors, no nested `wnpm/`, and only the planned root structure.

- [ ] **Step 2: Run final CI**

Run: `make ci`

Expected: exit 0.

- [ ] **Step 3: Confirm the hook delegates to CI**

Run: `grep -Fx 'exec make ci' .githooks/pre-push && test "$(git config core.hooksPath)" = .githooks`

Expected: both checks succeed.

- [ ] **Step 4: Review deletions and retained capabilities**

Run: `git diff --stat 594337d..HEAD && git status --short --branch`

Expected: the old implementation and workspace scaffolding are gone; the working tree is clean.
