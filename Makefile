.PHONY: install build test typecheck ci ci-comments ci-format

install:
	bun install
	git config core.hooksPath .githooks

build:
	bun run build

test:
	bun test

typecheck:
	bun run typecheck

ci-comments:
	bun scripts/strip-comments.mjs --selftest
	bun scripts/strip-comments.mjs --check

ci-format:
	bun run lint

ci:
	bun install --frozen-lockfile
	$(MAKE) ci-comments ci-format
	bun test
	bun run typecheck
	bun run build
	./dist/wnpx --schema >/dev/null
	./dist/wnpm invalid-command 2>&1 | grep -F 'unknown command "invalid-command"' >/dev/null
