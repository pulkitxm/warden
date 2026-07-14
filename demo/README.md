# WNPM — Demo Runbook (4 minutes)

Runs fully offline against the in-repo mini-registry. No network, no Docker, no
live-malicious packages. Rehearse this, not the code.

## Setup (once, before you present)

```sh
bun install
bun run build          # produces ./dist/wnpm and ./dist/wnpx

# Terminal A: start the mini npm registry (fixtures)
bun fixtures/registry/server.ts        # prints its URL to stderr

# Terminal B: copy the export lines printed by the server, then:
export WNPM_CACHE=/tmp/wnpm-demo.sqlite   # so beat 5 shows a cache hit

# For the doctor beat: a demo project with pinned vulnerable deps
cp -r fixtures/doctor-project /tmp/doctor-demo
```

## Beat 1 — the problem (20s)

"Coding agents run `npx` straight from skill files. npm got hit by Shai-Hulud,
the chalk/debug hijack, and an axios compromise — malware ran at install time,
in windows as short as three hours. Here's the pre-flight check npm never had."

## Beat 2 — typosquat block (40s)

```sh
wnpm install lodahs
```

Blocks: typosquat of `lodash` (distance 1), 47 downloads vs 300M weekly. Cancelled
before any script ran. Exit code 20.

## Beat 3 — hijacked-diff block (50s)

```sh
wnpm install acme-http@1.0.1
```

The clean 1.0.0 had provenance and no scripts. 1.0.1 adds a `postinstall` that
reads `process.env` and POSTs to a raw IP, published without provenance. WNPM
shows the diff evidence and blocks — categories `provenance_downgrade`,
`exfiltration`, `install_script`.

(Bonus) blocklist path, instant, no analysis:

```sh
wnpm install chalk@5.6.1     # BLOCK — known-malware blocklist (MAL-CHALK-2025)
```

## Beat 4 — the agent moment (50s, the wow)

```sh
bun demo/agent-sim.ts demo/skill-file/AGENTS.md
```

The skill file tells the agent to run `npx react-codeshift` (a real hallucinated
name that spread to 237 repos via 47 agent skill files in Jan 2026). The agent
follows repo policy, calls `wnpx react-codeshift --json`, gets
`{"verdict":"block","categories":["slopsquat"]}`, and refuses to run it —
explaining why. That JSON is the exact contract a real Codex agent gates on.

## Beat 5 — the doctor (60s)

```sh
cd /tmp/doctor-demo
wnpm doctor
```

Doctor finds two advisories (real npm installs and the project's own test suite
run live in throwaway workspaces):

- `acme-json@2.1.0` — prototype pollution, fixed in 2.1.4. Doctor generates a
  minimal plan (2.1.4, patch, in range) and a latest plan (2.2.0), verifies both
  with `npm install` + the project's tests, and recommends the smallest one.
- `acme-http@1.0.0` — the advisory says the fix is 1.0.1. **The supply-chain
  gate blocks 1.0.1** (new postinstall, env exfiltration to a raw IP, provenance
  gone) and doctor reports it UNFIXABLE instead of "fixing" the project into a
  hijacked release. Dependabot would have opened that PR.

```sh
wnpm doctor              # pins acme-json to the exact verified 2.1.4
```

## Beat 6 — close (20s)

```sh
wnpx left-pad --json     # allow: one clean JSON object on stdout
wnpm install acme-http@1.0.1   # run twice: second is a cache hit (source: cache)
```

"Same verdict a human reads, an agent gates on, and a doctor that repairs with.
One binary, three dependencies, and a false-positive corpus (`bun test`) that
says it won't cry wolf on your build tools."

## The test story (judges click)

```sh
bun test        # < 100ms. The benign corpus (esbuild/next/@babel/class-names)
                # must never block; the malicious corpus blocks for the right
                # categories. That suite is the differentiator.
```
