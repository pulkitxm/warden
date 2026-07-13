.PHONY: install build test typecheck ci

install:
	bun install
	git config core.hooksPath .githooks

build:
	bun run build

test:
	bun test

typecheck:
	bun run typecheck

ci:
	bun install --frozen-lockfile
	bun test
	bun run typecheck
	bun run build
	./dist/wnpx --schema >/dev/null
	./dist/wnpm invalid-command 2>&1 | grep -F 'unknown command "invalid-command"' >/dev/null
