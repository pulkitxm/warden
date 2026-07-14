# Configuration: `warden.config.json`

The cascading repo config, the user-level config, and how agent context files mirror the cascade.

Part of the [product plan](system-integration.md).

## JSON, not YAML

- The repo's config culture is already JSON (`package.json`, `tsconfig.json`, `biome.json`), and a `"$schema"` key gives editor autocomplete and validation for free.
- Agents read and write JSON natively; warden's primary consumers are agents.
- YAML's advantages (hand comments, anchors) do not apply to a schema-validated config, and YAML's parsing quirks are a liability for a security tool.
- The `name.config.json` pattern is the JS-ecosystem convention (`next.config.js`, `playwright.config.ts`, `vitest.config.ts`) and cannot be mistaken for a data file.
- The GitHub workflow stays YAML because GitHub requires it; that is the only YAML warden touches.

## Cascade

Same model as CLAUDE.md files: one `warden.config.json` at the repo root sets the defaults, and any package in a monorepo may carry its own `warden.config.json` that overrides them for that package's subtree.

- Resolution for a file or dependency: nearest config wins per key, deep-merged over the root, over built-in defaults.
- `warden ci` and the policy engine resolve config per finding location, so `apps/api` can forbid comments while `packages/legacy` only warns.
- User-level `~/.warden/config.json` stays separate: it holds machine behavior (mode, intercept, cache dir, agent) and is never versioned; repo configs hold policy and CI behavior and always are.

Root sketch:

```json
{
  "$schema": "https://raw.githubusercontent.com/pulkitxm/warden/main/schema/warden.config.json",
  "mode": "brief",
  "policies": {
    "comments": { "level": "forbid", "exclude": ["vendor/**"] },
    "format": { "command": "bun run lint" },
    "dependencies": { "licenses": ["MIT", "Apache-2.0"], "minAgeDays": 30 }
  },
  "cache": { "dir": "~/.warden/cache", "ttlHours": 24 },
  "ci": { "reporters": ["github", "summary"], "failOn": "block" }
}
```

Package-level override sketch (`packages/legacy/warden.config.json`):

```json
{
  "$schema": "https://raw.githubusercontent.com/pulkitxm/warden/main/schema/warden.config.json",
  "policies": {
    "comments": { "level": "warn" }
  }
}
```

## Cache semantics

Verdicts are keyed by `name@version` plus ruleset version, so CI runs restore `~/.warden/cache` and skip re-vetting unchanged dependencies.

## Agent context files

Agent context files follow the same cascade: `warden init` offers to write a warden section into the root `CLAUDE.md` (or `AGENTS.md`) and into each package's own file, stating the active policies, the commands that give feedback (`warden ci --reporter agent`), and per-package quirks. Agents then comply with policies before CI has to fail them, and package-local instructions stay next to the code they govern.
