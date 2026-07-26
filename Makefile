.PHONY: install build test test-doctor test-intent test-shell typecheck ci ci-comments ci-format doctor-demo docker-build docker-run docker-install-demo

install:
	bun install
	git config core.hooksPath .githooks

build:
	bun run build

test:
	bun test

test-doctor:
	bun test test/doctor/ test/cli/doctor.test.ts

test-intent:
	bun test test/intent/

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
	./dist/wnpm --help 2>&1 | grep -F 'usage:' >/dev/null
	./dist/warden doctor --help 2>&1 | grep -F 'usage: warden doctor' >/dev/null
	./dist/warden schema doctor >/dev/null
	./dist/warden schema intent >/dev/null
	./dist/warden schema audit >/dev/null
	./dist/warden check lockfile --dir fixtures/doctor-project --json >/dev/null

doctor-demo: build
	bun scripts/doctor-demo.ts

docker-build:
	@sh scripts/docker-build.sh warden:dev

docker-run: docker-build
	$(if $(ARGS),,@printf 'warden preinstalled: shims intercept npm/bun/npx, completions active   repo read-only at /work, try installs in /play\n')
	@printf '%s\n' '────────────────────────────────────────'
	@docker run --rm $(if $(ARGS),,-it --entrypoint /bin/bash -e SHELL=/bin/bash) -v "$$PWD:/work:ro" warden:dev $(if $(ARGS),$(ARGS),-c 'printf "warden: setting up shims and completions... "; WARDEN_INSTALL_SOURCE=/app sh /app/web/public/install.sh </dev/null >/tmp/warden-install.log 2>&1 && echo "done" || { echo "failed"; tail -n 20 /tmp/warden-install.log; echo "rerun: sh /app/web/public/install.sh"; }; exec bash')

docker-install-demo: docker-build
	@printf 'fresh container; run: sh /app/web/public/install.sh, then: source ~/.bashrc   try installs in /play\n'
	@printf '%s\n' '────────────────────────────────────────'
	@docker run --rm -it --entrypoint /bin/bash -e SHELL=/bin/bash -e WARDEN_INSTALL_SOURCE=/app -e PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin warden:dev
