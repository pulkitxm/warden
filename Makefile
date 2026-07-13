CACHE ?= :memory:
TARGETS := install build check check-json install-pkg test typecheck
ARGS := $(filter-out $(TARGETS),$(MAKECMDGOALS))
PKG ?= $(if $(ARGS),$(firstword $(ARGS)),react)

.PHONY: install
install:
	bun install

.PHONY: build
build:
	bun run build

.PHONY: check
check:
	WARDEN_CACHE=$(CACHE) bun src/cli/index.ts check $(PKG)

.PHONY: check-json
check-json:
	WARDEN_CACHE=$(CACHE) bun src/cli/index.ts check $(PKG) --json

.PHONY: install-pkg
install-pkg:
	WARDEN_CACHE=$(CACHE) bun src/cli/index.ts install $(PKG)

.PHONY: test
test:
	bun test

.PHONY: typecheck
typecheck:
	bun run typecheck

%:
	@:
