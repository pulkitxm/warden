# Detection

WNPM scans only new or changed package files and compares lifecycle scripts with the preceding release. Its deterministic signals cover:

- package-name impersonation and curated hallucinated names
- known-malware blocklist matches
- provenance loss and maintainer replacement
- added or changed lifecycle scripts
- shell execution, dynamic evaluation, and reverse shells
- credential or source-file access
- raw-IP, metadata-service, DNS, and environment-exfiltration patterns
- destructive filesystem operations
- obfuscation and encoded payloads
- raw URL or Git dependencies

Blocking requires a high-confidence name attack, a known-malware match, a reverse shell, or corroborated action signals. Capability-only signals generally warn. Established packages suppress noisy capability correlations, while hard takeover evidence remains active.

The false-positive and true-positive corpus in `test/score.test.ts` is part of the CI gate.
