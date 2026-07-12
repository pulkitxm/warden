# Warden — Vulnerability Suite Results

Cases: 73 (malicious 25, benign 48). No LLM (pure heuristics).

## Confusion matrix (positive = should block)

```
                 predicted BLOCK   predicted not-block
malicious (P)         TP=25              FN=0
benign    (N)         FP=0              TN=48
```
- Recall (malicious caught, strict block): 100.0%
- Precision (of blocks, how many truly malicious): 100.0%
- Specificity (benign correctly not blocked): 100.0%
- Accuracy: 100.0%  ·  F1: 1.00
- Lenient recall (malicious at least WARNed): 100.0%

## Failure points (analyze these)

### False negatives — malicious NOT blocked (misses)
_(none)_

### False positives — benign blocked (false alarms)
_(none)_

## Per-type breakdown

| label:type | total | block | warn | allow | error |
|---|---|---|---|---|---|
| benign:real-popular | 48 | 0 | 17 | 31 | 0 |
| malicious:base64-eval-loader | 1 | 1 | 0 | 0 | 0 |
| malicious:blocklist-known-malware | 3 | 3 | 0 | 0 | 0 |
| malicious:cloud-imds-theft | 1 | 1 | 0 | 0 | 0 |
| malicious:curl-pipe-bash | 1 | 1 | 0 | 0 | 0 |
| malicious:dependency-confusion | 1 | 1 | 0 | 0 | 0 |
| malicious:fake-native-download | 1 | 1 | 0 | 0 | 0 |
| malicious:homoglyph-typosquat | 1 | 1 | 0 | 0 | 0 |
| malicious:obfuscated-eval-drainer | 1 | 1 | 0 | 0 | 0 |
| malicious:postinstall-env-exfil | 1 | 1 | 0 | 0 | 0 |
| malicious:preinstall-cred-harvester | 1 | 1 | 0 | 0 | 0 |
| malicious:protestware | 1 | 1 | 0 | 0 | 0 |
| malicious:provenance-downgrade | 1 | 1 | 0 | 0 | 0 |
| malicious:reverse-shell | 1 | 1 | 0 | 0 | 0 |
| malicious:secret-file-theft | 1 | 1 | 0 | 0 | 0 |
| malicious:slopsquat | 2 | 2 | 0 | 0 | 0 |
| malicious:slopsquat-scoped | 1 | 1 | 0 | 0 | 0 |
| malicious:source-code-leak | 1 | 1 | 0 | 0 | 0 |
| malicious:typosquat | 5 | 5 | 0 | 0 | 0 |

## All results

| spec | label | type | verdict | score | categories |
|---|---|---|---|---|---|
| @babel/core | benign | real-popular | allow | 0 |  |
| @types/node | benign | real-popular | allow | 0 |  |
| @typescript-eslint/parser | benign | real-popular | allow | 0 |  |
| axios | benign | real-popular | warn | 30 | obfuscation |
| bcrypt | benign | real-popular | warn | 25 | install_script |
| better-sqlite3 | benign | real-popular | allow | 0 |  |
| chalk | benign | real-popular | allow | 0 |  |
| chokidar | benign | real-popular | warn | 20 | metadata_anomaly |
| commander | benign | real-popular | warn | 30 | install_script,metadata_anomaly |
| core-js | benign | real-popular | allow | 0 |  |
| cross-env | benign | real-popular | allow | 0 |  |
| d3 | benign | real-popular | warn | 49 | obfuscation |
| debug | benign | real-popular | allow | 0 |  |
| dotenv | benign | real-popular | allow | 0 |  |
| esbuild | benign | real-popular | allow | 20 | install_script |
| eslint | benign | real-popular | warn | 35 | obfuscation,metadata_anomaly |
| express | benign | real-popular | warn | 20 | metadata_anomaly |
| fastify | benign | real-popular | warn | 90 | obfuscation,exfiltration,metadata_anomaly |
| glob | benign | real-popular | allow | 0 |  |
| got | benign | real-popular | warn | 55 | exfiltration,metadata_anomaly |
| jest | benign | real-popular | allow | 0 |  |
| koa | benign | real-popular | allow | 0 |  |
| lodash | benign | real-popular | allow | 0 |  |
| moment | benign | real-popular | allow | 0 |  |
| ms | benign | real-popular | allow | 0 |  |
| next | benign | real-popular | warn | 100 | obfuscation,exfiltration,install_script,metadata_anomaly |
| node-fetch | benign | real-popular | allow | 0 |  |
| node-gyp | benign | real-popular | allow | 0 |  |
| prettier | benign | real-popular | allow | 0 |  |
| qs | benign | real-popular | allow | 0 |  |
| react | benign | real-popular | allow | 0 |  |
| react-dom | benign | real-popular | allow | 0 |  |
| rimraf | benign | real-popular | allow | 0 |  |
| rollup | benign | real-popular | warn | 30 | obfuscation,install_script |
| semver | benign | real-popular | allow | 0 |  |
| sharp | benign | real-popular | allow | 0 |  |
| svelte | benign | real-popular | allow | 0 |  |
| three | benign | real-popular | allow | 0 |  |
| typescript | benign | real-popular | warn | 70 | obfuscation,install_script,metadata_anomaly |
| undici | benign | real-popular | allow | 0 |  |
| uuid | benign | real-popular | warn | 25 | install_script |
| vite | benign | real-popular | warn | 96 | obfuscation,exfiltration,metadata_anomaly |
| vitest | benign | real-popular | warn | 100 | exfiltration,install_script,obfuscation,metadata_anomaly |
| vue | benign | real-popular | warn | 60 | obfuscation |
| webpack | benign | real-popular | allow | 0 |  |
| ws | benign | real-popular | allow | 0 |  |
| yargs | benign | real-popular | warn | 20 | metadata_anomaly |
| zod | benign | real-popular | allow | 0 |  |
| @acme-corp/internal-config@99.0.0 | malicious | dependency-confusion | block | 90 | install_script,exfiltration,metadata_anomaly |
| @typescript_eslinter/eslint | malicious | slopsquat-scoped | block | 65 | typosquat,metadata_anomaly |
| axios@1.14.1 | malicious | blocklist-known-malware | block | 100 | known_malware |
| axsios | malicious | typosquat | block | 90 | slopsquat |
| chalk@5.6.1 | malicious | blocklist-known-malware | block | 100 | known_malware |
| data-fetch-utils-pro-2026 | malicious | slopsquat | block | 90 | slopsquat |
| expresss | malicious | typosquat | block | 60 | typosquat,metadata_anomaly |
| l0dash | malicious | homoglyph-typosquat | block | 90 | slopsquat |
| lodahs | malicious | typosquat | block | 60 | typosquat,metadata_anomaly |
| mal-base64-loader@1.0.0 | malicious | base64-eval-loader | block | 95 | install_script,obfuscation,metadata_anomaly |
| mal-curl-bash@0.0.1 | malicious | curl-pipe-bash | block | 100 | install_script,exfiltration,metadata_anomaly |
| mal-fake-native@1.0.0 | malicious | fake-native-download | block | 90 | install_script,exfiltration,metadata_anomaly |
| mal-imds-steal@1.0.0 | malicious | cloud-imds-theft | block | 100 | install_script,exfiltration,metadata_anomaly |
| mal-obfuscated-eval@1.2.0 | malicious | obfuscated-eval-drainer | block | 95 | obfuscation,metadata_anomaly |
| mal-postinstall-env@1.0.1 | malicious | postinstall-env-exfil | block | 100 | install_script,exfiltration,metadata_anomaly |
| mal-preinstall-harvester@2.0.0 | malicious | preinstall-cred-harvester | block | 100 | install_script,exfiltration,metadata_anomaly |
| mal-protestware@2.0.0 | malicious | protestware | block | 85 | install_script,metadata_anomaly |
| mal-provenance-downgrade@1.0.1 | malicious | provenance-downgrade | block | 100 | install_script,exfiltration,provenance_downgrade,metadata_anomaly |
| mal-reverse-shell@1.0.0 | malicious | reverse-shell | block | 100 | install_script,exfiltration,metadata_anomaly |
| mal-secret-theft@1.0.0 | malicious | secret-file-theft | block | 100 | install_script,exfiltration,metadata_anomaly |
| mal-source-leak@1.0.0 | malicious | source-code-leak | block | 100 | install_script,exfiltration,metadata_anomaly |
| momnet | malicious | typosquat | block | 60 | typosquat,metadata_anomaly |
| plain-crypto-js | malicious | blocklist-known-malware | block | 100 | known_malware |
| react-hooks-fetcher-helper-xyz | malicious | slopsquat | block | 90 | slopsquat |
| reqeust | malicious | typosquat | block | 80 | exfiltration,typosquat,metadata_anomaly |
