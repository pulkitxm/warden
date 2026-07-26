# Warden speaker script

One block per slide, in order. Read it straight through, pause where the terminal is typing. Every terminal slide has a SKIP control in its title bar: press it to jump straight to the final state when you are short on time.

## 1. Cover

Every dependency change becomes a verified transaction. That's Warden in one line. Not a scanner that reports on a package after the fact, but a layer that plans the whole change, makes you approve only the part that executes, and can prove in CI that the change went through the reviewed path. It works the same whether a developer or a coding agent made the request.

## 2. The attack surface

The package is the payload. In 2025 alone, Sonatype found four hundred fifty four thousand six hundred forty eight malicious packages. The CVE program published forty eight thousand vulnerabilities. And a USENIX study found language models hallucinating over two hundred thousand fake package names, names attackers can register before anyone else does.

## 3. Core loop: check

Here's the loop: resolve, verify, diff, scan, score, before anything runs. Watch this. We run `warden check` against a typosquatted package. It verifies integrity, checks the release diff, checks provenance, scans the code, and blocks it at a risk score of one hundred, before the install even starts.

## 4. The core loop: plan and approve

This is the slide that matters. You type `npm install esbuild`. That is one name, but twenty-seven packages arrive with it. Checking the name you typed leaves the other twenty-six unexamined, and a transitive addition is exactly where a compromised release hides.

So Warden resolves the complete prospective graph from registry metadata, without running a line of package code, and analyzes all twenty-seven. Watch the counters: that is real work, and Warden narrates it rather than going quiet, because a tool that goes silent for half a minute is a tool people turn off.

Then the decision. Exactly one package in this change wants to execute code at install time: esbuild's own postinstall. So the answer is not "allow" and not "block", it is "approve this one script". And that approval is bound to the version, the tarball digest, the hook, and the script body. Change any of them and it is void. Everything else installs with scripts suppressed.

## 5. Live product: doctor

Same gate, run backward, across what's already installed. `wnpm doctor` audits your dependencies against OSV advisories, finds a critical vulnerability, and tries the official fix. But the official fix itself fails the supply chain gate, so it's marked unfixable and Warden tells you exactly why.

## 5. Live product: intent

This is the new one: claims from the prompt, checked against the diff. You tell your agent to add rate limiting, keep the retry logic, and log every rate-limited request. Warden extracts those three claims, checks them against what actually changed, and catches what most reviewers miss: a dropped requirement, scope creep in a file nobody asked to touch, and a hallucinated API call that doesn't exist.

## 6. Product surface

One trust layer, every workflow. Eight commands, one contract: allow, warn, or block. Check a package, gate CI, audit and repair, diff intent against a prompt, map your workspace, wire up guardrails, hand off a fix to an agent, or just observe. It shims npm, pnpm, yarn, bun, npx, and bunx. Protect mode blocks. Observe mode just records.

## 7. Agent-first guardrail

Your agent gets evidence, a fix, and a finish line. Warden writes a structured handoff file the agent can read, so instead of guessing, it gets the finding, the evidence, and the fix already spelled out. It works the same way across Claude Code, Codex, Cursor, Copilot, Gemini, aider, and opencode: detect, handoff, fix, verify clean.

## 8. Close

Keep the workflow, add the checkpoint. Request goes to Warden, Warden returns a verified execution, everywhere: local, package managers, CI, coding agents. Same package we opened with, now allowed, risk four out of a hundred.

## 9. Sources

Everything on the numbers slide traces back to four sources: the CVE Program, the Sonatype 2026 report, the USENIX Security 2025 hallucination study, and the OSV advisory database. Figures checked July 14th, 2026.
