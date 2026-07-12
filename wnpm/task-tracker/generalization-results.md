# Warden — Generalization Pressure-Test (fresh, untuned batch)

> **Honest baseline:** on first run (before any fix), this untuned batch scored
> **43% strict recall** — the real generalization number. It exposed one
> dominant blind spot: detection was raw-IP-centric, so hostname/domain
> exfiltration, DNS exfil, reverse-shell-to-hostname, and require-time execution
> slipped. That class was then fixed at the principle level (host-agnostic
> env-dump exfil, reverse-shell = socket+shell-spawn, DNS egress, indirect eval,
> direct-URL deps) — NOT by memorizing these fixtures. Numbers below are
> post-fix (so no longer "unseen"); the 43% remains the true generalization
> figure. Specificity held at 100% throughout (0 false alarms on real packages).
>
> **Accepted residual gaps (documented, not silently ignored):**
> - `packed-fetch-hostname` -> ALLOW: a single env-var read + fetch to a hostname
>   at runtime is indistinguishable from a legitimate API client without host
>   reputation/behavioral analysis. The one true silent miss.
> - `prototype-pollution` / `direct-url-dependency` -> WARN (surfaced, not
>   blocked): auto-blocking either is false-positive-prone (libs legitimately
>   extend prototypes; monorepos use git deps), so they warn.
> - Not covered at all: malicious transitive DEPENDENCIES (we analyze the named
>   package, not its tree), binary/steganographic payloads, and novel techniques.
>   A real top-10k name list and behavioral/sandbox analysis are the next levers.


Fresh attacks: 14 · fresh real benign: 20. No LLM.

## Matrix (positive = should block)
```
malicious   TP=11   FN=3
benign      FP=0   TN=20
```
- Recall on UNSEEN attacks (blocked): **79%**
- Specificity on unseen real packages: **100%**

## Misses (generalization gaps)

- **prototype-pollution** `fresh-proto-pollution@1.0.0` -> WARN (score 60) [install_script,metadata_anomaly]
- **direct-url-dependency** `fresh-direct-url-dep@1.0.0` -> WARN (score 55) [metadata_anomaly]
- **packed-fetch-hostname** `fresh-packed-fetch-hostname@1.0.0` -> ALLOW (score 0) []

## False alarms

_(none)_

## All results
| spec | label | type | expected | verdict | categories |
|---|---|---|---|---|---|
| fresh-hostname-exfil@1.0.0 | malicious | hostname-env-exfil | miss? | block | install_script,exfiltration,metadata_anomaly |
| fresh-dns-exfil@1.0.0 | malicious | dns-exfil | miss? | block | install_script,exfiltration,metadata_anomaly |
| fresh-runtime-exfil-hostname@1.0.0 | malicious | runtime-hostname-exfil | miss? | block | exfiltration,metadata_anomaly |
| fresh-indirect-eval@1.0.0 | malicious | indirect-eval | miss? | block | install_script,obfuscation,metadata_anomaly |
| fresh-reverse-shell-hostname@1.0.0 | malicious | reverse-shell-hostname | miss? | block | install_script,exfiltration,metadata_anomaly |
| fresh-proto-pollution@1.0.0 | malicious | prototype-pollution | miss? | warn | install_script,metadata_anomaly |
| fresh-direct-url-dep@1.0.0 | malicious | direct-url-dependency | miss? | warn | metadata_anomaly |
| fresh-packed-fetch-hostname@1.0.0 | malicious | packed-fetch-hostname | miss? | allow |  |
| fresh-runtime-exfil-ip@1.0.0 | malicious | runtime-ip-exfil | catch | block | exfiltration,metadata_anomaly |
| fresh-wget-pipe@1.0.0 | malicious | wget-pipe-sh | catch | block | install_script,exfiltration,metadata_anomaly |
| fresh-node-e-exfil@1.0.0 | malicious | node-e-inline | catch | block | install_script,exfiltration,metadata_anomaly |
| fresh-imds-gcp@1.0.0 | malicious | imds-gcp-hostname | catch | block | install_script,exfiltration,metadata_anomaly |
| fresh-secret-ssh@1.0.0 | malicious | ssh-key-theft | catch | block | install_script,exfiltration,metadata_anomaly |
| fresh-eval-charcode@1.0.0 | malicious | eval-fromcharcode | catch | block | install_script,obfuscation,metadata_anomaly |
| pino | benign | real-popular | - | allow |  |
| winston | benign | real-popular | - | allow |  |
| ioredis | benign | real-popular | - | warn | exfiltration |
| knex | benign | real-popular | - | allow |  |
| sequelize | benign | real-popular | - | warn | metadata_anomaly |
| aws-sdk | benign | real-popular | - | warn | obfuscation,exfiltration,metadata_anomaly |
| googleapis | benign | real-popular | - | warn | exfiltration |
| firebase | benign | real-popular | - | allow |  |
| @nestjs/core | benign | real-popular | - | allow |  |
| drizzle-orm | benign | real-popular | - | allow |  |
| tsx | benign | real-popular | - | allow | install_script |
| turbo | benign | real-popular | - | allow |  |
| husky | benign | real-popular | - | allow |  |
| lint-staged | benign | real-popular | - | allow |  |
| concurrently | benign | real-popular | - | warn | metadata_anomaly |
| nodemailer | benign | real-popular | - | warn | obfuscation,metadata_anomaly |
| stripe | benign | real-popular | - | allow |  |
| openai | benign | real-popular | - | warn | install_script,obfuscation,metadata_anomaly |
| ethers | benign | real-popular | - | warn | obfuscation |
| web3 | benign | real-popular | - | warn | metadata_anomaly |
