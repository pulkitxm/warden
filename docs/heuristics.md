# Heuristics and scoring

The deterministic core lives in [`src/heuristics/`](../src/heuristics/). It
turns package metadata plus the tarball diff into weighted signals and a 0–10
score, with no network and no model.

## Signals

| Flag | Source | Weight | Action signal |
|---|---|---|---|
| `typosquat` | name within 2 edits (Damerau/OSA) of a popular package, scope ignored | 4–5 (scales with target popularity) | yes |
| `new_postinstall` / `new_install_script` | lifecycle script added or changed vs the previous version | 2.5 | yes |
| `network_in_script` | curl/wget/netcat//dev/tcp in script bodies; http(s)/net/fetch in code; raw IPs | 2–3 | yes |
| `suspicious_script_content` | eval/`new Function`/`node -e`, base64 decode chains, child_process, env+network exfil shape | 1.5–2.5 (exfil combo +2.5) | yes |
| `obfuscated` | worst-file obfuscation score ≥ 0.5 (giant lines, encoded blobs, hex runs, high entropy) | 2.5–3 | yes |
| `writes_agent_config` | package ships or writes `.claude/`, `.codex/`, `.cursor/`, `AGENTS.md` | 4 | yes |
| `maintainer_changed` | complete maintainer turnover since the previous version | 2.5 | yes |
| `deprecated` | registry deprecation notice | 1 | no |
| `recent_publish` | published ≤ 14 days ago | 1.5 | **gated** |
| `low_install_history` | < 1 000 weekly downloads | 1 | **gated** |
| `known_vulnerability` | OSV.dev advisories for the exact version (enrichment) | ≤ 4 | no |
| `license_copyleft` | GPL/AGPL/LGPL from deps.dev (informational) | 0.5 | no |

**Gated** means the signal is dropped unless at least one *action* signal is
also present — newness alone never raises risk (a brand-new, script-free,
no-collision package scores LOW).

## Content scanning

Script bodies (lifecycle strings) are pattern-scanned; JavaScript/TypeScript
files are **AST-scanned** with `@babel/parser` (`eval`, `new Function`,
`require`/`import` of `child_process` and network modules, `fetch`,
`Buffer.from(x, "base64")`, `process.env` reads, raw IPv4 literals). Files
that fail to parse fall back to a regex pass, so broken or minified code is
still inspected. Only added/changed files are scanned on an update; the whole
package is scanned when it is new.

An **exfiltration shape** — an environment read *plus* network capability in
the same change set — earns an extra signal; an env read alone is discarded as
noise (every config-reading library does it).

## Scoring

`score()` sums the applicable weights, then:

- **Trusted-maintainer damping** — a package with ≥ 25 releases and a stable
  maintainer set has residual (non-action) noise multiplied by 0.3. Action
  signals are never damped: a hijacked veteran package still scores full.
- Clamped to 0–10 and mapped to a level: `< 3` **LOW** · `3–6.4` **MEDIUM** ·
  `≥ 6.5` **HIGH**.
- Level maps to the recommendation: LOW→`allow`, MEDIUM→`confirm_with_human`,
  HIGH→`block`. When the LLM writes the explanation it may *escalate* the
  recommendation but can never lower it below this floor.

## Known limitations

- The popular-package list for typosquat detection is a bundled ~20-name seed;
  a real top-N list is a roadmap item (the `wnpm/` monorepo ships ~120).
- Static analysis cannot catch a package that reads one env var and posts it
  to a plausible-looking hostname at runtime — indistinguishable from a
  legitimate API client without behavioral/sandbox analysis.
- Transitive dependencies are not analyzed (only what is named on the command
  line or in `package.json`); `warden install` mitigates by leaving their
  lifecycle scripts disabled.
- Binary payloads are recorded but not inspected.
