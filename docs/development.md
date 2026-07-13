# Development

WNPM uses Bun for dependencies, tests, SQLite, and standalone binary builds. TypeScript performs strict type-checking.

```sh
make install     # install dependencies and activate .githooks
make test
make typecheck
make build
make ci          # the complete local/GitHub/pre-push workflow
```

`make ci` rejects disallowed code comments and any Biome formatting or lint error. Run `bun run strip-comments` and `bun run format` to repair those checks locally. Functional directives such as `@ts-expect-error` and `biome-ignore` are preserved.

Tests run offline except the manual pressure-test scripts. The test suite enforces 100% line and function coverage for loaded source files.

The repository has one implementation:

- `src/` — engine, CLI, and focused modules
- `test/` — unit and CLI integration tests
- `fixtures/` — offline npm registry and attack fixtures
- `demo/` — end-to-end agent-gating example
- `scripts/` — manual live-registry pressure tests
- `research/` — verified source citations

Configuration:

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Optional explanation generation |
| `WNPM_LLM_MODEL` | Explanation model; defaults to `gpt-4o-mini` |
| `WNPM_CACHE` | SQLite verdict cache path |
| `WNPM_REGISTRY` | npm registry base URL |
| `WNPM_DOWNLOADS` | npm downloads API base URL |
| `NO_COLOR` | Disable ANSI colors |
