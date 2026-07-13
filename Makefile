.PHONY: install build test test-shell typecheck ci ci-comments ci-format docker-build docker-run docker-install-demo

install:
	bun install
	git config core.hooksPath .githooks

build:
	bun run build

test:
	bun test

test-shell:
	bun test test/shell/

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
	./dist/warden --help 2>&1 | grep -F 'usage: warden <verb> [flags]' >/dev/null
	./dist/warden check --help 2>&1 | grep -F 'usage: warden check' >/dev/null
	./dist/wnpx --schema >/dev/null
	./dist/wnpm invalid-command 2>&1 | grep -F 'unknown command "invalid-command"' >/dev/null

docker-build:
	@docker build -t warden:dev . >/tmp/warden-docker-build.log 2>&1 & pid=$$!; \
	if [ -t 1 ]; then \
	  while kill -0 $$pid 2>/dev/null; do \
	    for c in '|' '/' '-' '\'; do printf '\rdocker: building warden:dev %s' "$$c"; sleep 0.1; done; \
	  done; \
	else \
	  printf 'docker: building warden:dev...'; \
	fi; \
	wait $$pid && printf '\rdocker: building warden:dev... done\n' \
	  || { printf '\rdocker: building warden:dev... failed\n'; cat /tmp/warden-docker-build.log; exit 1; }

docker-run: docker-build
	$(if $(ARGS),,@printf 'warden preinstalled: shims intercept npm/bun/npx, completions active   repo read-only at /work, try installs in /play\n')
	@printf '%s\n' '────────────────────────────────────────'
	@docker run --rm $(if $(ARGS),,-it --entrypoint /bin/bash -e SHELL=/bin/bash) -v "$$PWD:/work:ro" warden:dev $(if $(ARGS),$(ARGS),-c 'WARDEN_INSTALL_SOURCE=/app sh /app/install.sh </dev/null >/dev/null 2>&1 || { echo "warden setup failed; rerun: sh /app/install.sh"; }; exec bash')

docker-install-demo: docker-build
	@printf 'fresh container; run: sh /app/install.sh   try installs in /play\n'
	@printf '%s\n' '────────────────────────────────────────'
	@docker run --rm -it --entrypoint /bin/bash -e WARDEN_INSTALL_SOURCE=/app -e PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin warden:dev
