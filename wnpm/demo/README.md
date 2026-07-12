# Warden — Demo Runbook (3 minutes)

Runs fully offline against the in-repo mini-registry. No network, no Docker, no
live-malicious packages. Rehearse this, not the code.

## Setup (once, before you present)

```sh
bun install
bun run build          # produces ./dist/wnpm and ./dist/wnpx

# Terminal A: start the mini npm registry (fixtures)
bun fixtures/registry/server.ts        # listens on :4873

# Terminal B: point Warden at it
export WARDEN_REGISTRY=http://localhost:4873
export WARDEN_DOWNLOADS=http://localhost:4873/downloads/point/last-week
export WARDEN_CACHE=/tmp/warden-demo.sqlite   # so beat 5 shows a cache hit
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
reads `process.env` and POSTs to a raw IP, published without provenance. Warden
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

## Beat 5 — close (20s)

```sh
wnpx left-pad --json     # allow: one clean JSON object on stdout
wnpm install acme-http@1.0.1   # run twice: second is a cache hit (source: cache)
```

"Same verdict a human reads, an agent gates on. One binary, three dependencies,
and a false-positive corpus (`bun test`) that says it won't cry wolf on your
build tools."

## The test story (judges click)

```sh
bun test        # < 100ms. The benign corpus (esbuild/next/@babel/class-names)
                # must never block; the malicious corpus blocks for the right
                # categories. That suite is the differentiator.
```
