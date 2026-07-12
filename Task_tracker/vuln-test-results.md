# Warden — Vulnerability Suite Results

Cases: 73 (malicious 25, benign 48). No LLM (pure heuristics).

## Confusion matrix (positive = should block)

```
                 predicted BLOCK   predicted not-block
malicious (P)         TP=15              FN=10
benign    (N)         FP=2              TN=46
```
- Recall (malicious caught, strict block): 60.0%
- Precision (of blocks, how many truly malicious): 88.2%
- Specificity (benign correctly not blocked): 95.8%
- Accuracy: 83.6%  ·  F1: 0.71
- Lenient recall (malicious at least WARNed): 92.0%

## Failure points (analyze these)

### False negatives — malicious NOT blocked (misses)
- **curl-pipe-bash** `mal-curl-bash@0.0.1` -> WARN (score 100) [install_script,exfiltration,metadata_anomaly]
- **base64-eval-loader** `mal-base64-loader@1.0.0` -> WARN (score 95) [install_script,obfuscation,metadata_anomaly]
- **source-code-leak** `mal-source-leak@1.0.0` -> WARN (score 90) [install_script,exfiltration,metadata_anomaly]
- **cloud-imds-theft** `mal-imds-steal@1.0.0` -> WARN (score 90) [install_script,exfiltration,metadata_anomaly]
- **reverse-shell** `mal-reverse-shell@1.0.0` -> WARN (score 100) [install_script,exfiltration,metadata_anomaly]
- **dependency-confusion** `@acme-corp/internal-config@99.0.0` -> WARN (score 90) [install_script,exfiltration,metadata_anomaly]
- **protestware** `mal-protestware@2.0.0` -> WARN (score 60) [install_script,metadata_anomaly]
- **fake-native-download** `mal-fake-native@1.0.0` -> WARN (score 90) [install_script,exfiltration,metadata_anomaly]
- **typosquat** `reqeust` -> ALLOW (score 0) []
- **slopsquat-scoped** `@typescript_eslinter/eslint` -> ALLOW (score 0) []

### False positives — benign blocked (false alarms)
- `d3` -> BLOCK (score 51) [obfuscation]
- `next` -> BLOCK (score 100) [obfuscation,install_script,exfiltration,metadata_anomaly]

## Per-type breakdown

| label:type | total | block | warn | allow | error |
|---|---|---|---|---|---|
| benign:real-popular | 48 | 2 | 21 | 25 | 0 |
| malicious:base64-eval-loader | 1 | 0 | 1 | 0 | 0 |
| malicious:blocklist-known-malware | 3 | 3 | 0 | 0 | 0 |
| malicious:cloud-imds-theft | 1 | 0 | 1 | 0 | 0 |
| malicious:curl-pipe-bash | 1 | 0 | 1 | 0 | 0 |
| malicious:dependency-confusion | 1 | 0 | 1 | 0 | 0 |
| malicious:fake-native-download | 1 | 0 | 1 | 0 | 0 |
| malicious:homoglyph-typosquat | 1 | 1 | 0 | 0 | 0 |
| malicious:obfuscated-eval-drainer | 1 | 1 | 0 | 0 | 0 |
| malicious:postinstall-env-exfil | 1 | 1 | 0 | 0 | 0 |
| malicious:preinstall-cred-harvester | 1 | 1 | 0 | 0 | 0 |
| malicious:protestware | 1 | 0 | 1 | 0 | 0 |
| malicious:provenance-downgrade | 1 | 1 | 0 | 0 | 0 |
| malicious:reverse-shell | 1 | 0 | 1 | 0 | 0 |
| malicious:secret-file-theft | 1 | 1 | 0 | 0 | 0 |
| malicious:slopsquat | 2 | 2 | 0 | 0 | 0 |
| malicious:slopsquat-scoped | 1 | 0 | 0 | 1 | 0 |
| malicious:source-code-leak | 1 | 0 | 1 | 0 | 0 |
| malicious:typosquat | 5 | 4 | 0 | 1 | 0 |

## All results

| spec | label | type | verdict | score | categories |
|---|---|---|---|---|---|
| @babel/core | benign | real-popular | allow | 0 |  |
| @types/node | benign | real-popular | allow | 0 |  |
| @typescript-eslint/parser | benign | real-popular | allow | 0 |  |
| axios | benign | real-popular | warn | 88 | obfuscation |
| bcrypt | benign | real-popular | warn | 25 | install_script |
| better-sqlite3 | benign | real-popular | allow | 0 |  |
| chalk | benign | real-popular | allow | 0 |  |
| chokidar | benign | real-popular | warn | 20 | metadata_anomaly |
| commander | benign | real-popular | warn | 30 | install_script,metadata_anomaly |
| core-js | benign | real-popular | allow | 0 |  |
| cross-env | benign | real-popular | allow | 0 |  |
| d3 | benign | real-popular | block | 51 | obfuscation |
| debug | benign | real-popular | allow | 0 |  |
| dotenv | benign | real-popular | allow | 0 |  |
| esbuild | benign | real-popular | allow | 20 | install_script |
| eslint | benign | real-popular | warn | 63 | obfuscation,metadata_anomaly |
| express | benign | real-popular | warn | 20 | metadata_anomaly |
| fastify | benign | real-popular | warn | 90 | obfuscation,exfiltration,metadata_anomaly |
| glob | benign | real-popular | warn | 58 | obfuscation |
| got | benign | real-popular | allow | 0 |  |
| jest | benign | real-popular | allow | 0 |  |
| koa | benign | real-popular | allow | 0 |  |
| lodash | benign | real-popular | warn | 29 | obfuscation |
| moment | benign | real-popular | warn | 58 | obfuscation |
| ms | benign | real-popular | allow | 0 |  |
| next | benign | real-popular | block | 100 | obfuscation,install_script,exfiltration,metadata_anomaly |
| node-fetch | benign | real-popular | allow | 0 |  |
| node-gyp | benign | real-popular | allow | 0 |  |
| prettier | benign | real-popular | warn | 100 | obfuscation,metadata_anomaly |
| qs | benign | real-popular | warn | 29 | obfuscation |
| react | benign | real-popular | allow | 0 |  |
| react-dom | benign | real-popular | warn | 58 | obfuscation |
| rimraf | benign | real-popular | allow | 0 |  |
| rollup | benign | real-popular | warn | 88 | obfuscation,install_script |
| semver | benign | real-popular | allow | 0 |  |
| sharp | benign | real-popular | allow | 0 |  |
| svelte | benign | real-popular | allow | 0 |  |
| three | benign | real-popular | warn | 44 | obfuscation,metadata_anomaly |
| typescript | benign | real-popular | warn | 70 | obfuscation,install_script,metadata_anomaly |
| undici | benign | real-popular | allow | 0 |  |
| uuid | benign | real-popular | warn | 25 | install_script |
| vite | benign | real-popular | warn | 79 | obfuscation,metadata_anomaly |
| vitest | benign | real-popular | warn | 94 | install_script,obfuscation,metadata_anomaly |
| vue | benign | real-popular | warn | 60 | obfuscation |
| webpack | benign | real-popular | allow | 0 |  |
| ws | benign | real-popular | allow | 0 |  |
| yargs | benign | real-popular | warn | 20 | metadata_anomaly |
| zod | benign | real-popular | allow | 0 |  |
| @acme-corp/internal-config@99.0.0 | malicious | dependency-confusion | warn | 90 | install_script,exfiltration,metadata_anomaly |
| @typescript_eslinter/eslint | malicious | slopsquat-scoped | allow | 0 |  |
| axios@1.14.1 | malicious | blocklist-known-malware | block | 100 | known_malware |
| axsios | malicious | typosquat | block | 90 | slopsquat |
| chalk@5.6.1 | malicious | blocklist-known-malware | block | 100 | known_malware |
| data-fetch-utils-pro-2026 | malicious | slopsquat | block | 90 | slopsquat |
| expresss | malicious | typosquat | block | 60 | typosquat,metadata_anomaly |
| l0dash | malicious | homoglyph-typosquat | block | 90 | slopsquat |
| lodahs | malicious | typosquat | block | 60 | typosquat,metadata_anomaly |
| mal-base64-loader@1.0.0 | malicious | base64-eval-loader | warn | 95 | install_script,obfuscation,metadata_anomaly |
| mal-curl-bash@0.0.1 | malicious | curl-pipe-bash | warn | 100 | install_script,exfiltration,metadata_anomaly |
| mal-fake-native@1.0.0 | malicious | fake-native-download | warn | 90 | install_script,exfiltration,metadata_anomaly |
| mal-imds-steal@1.0.0 | malicious | cloud-imds-theft | warn | 90 | install_script,exfiltration,metadata_anomaly |
| mal-obfuscated-eval@1.2.0 | malicious | obfuscated-eval-drainer | block | 95 | obfuscation,metadata_anomaly |
| mal-postinstall-env@1.0.1 | malicious | postinstall-env-exfil | block | 100 | install_script,exfiltration,metadata_anomaly |
| mal-preinstall-harvester@2.0.0 | malicious | preinstall-cred-harvester | block | 100 | install_script,exfiltration,metadata_anomaly |
| mal-protestware@2.0.0 | malicious | protestware | warn | 60 | install_script,metadata_anomaly |
| mal-provenance-downgrade@1.0.1 | malicious | provenance-downgrade | block | 100 | install_script,exfiltration,provenance_downgrade,metadata_anomaly |
| mal-reverse-shell@1.0.0 | malicious | reverse-shell | warn | 100 | install_script,exfiltration,metadata_anomaly |
| mal-secret-theft@1.0.0 | malicious | secret-file-theft | block | 100 | install_script,exfiltration,metadata_anomaly |
| mal-source-leak@1.0.0 | malicious | source-code-leak | warn | 90 | install_script,exfiltration,metadata_anomaly |
| momnet | malicious | typosquat | block | 60 | typosquat,metadata_anomaly |
| plain-crypto-js | malicious | blocklist-known-malware | block | 100 | known_malware |
| react-hooks-fetcher-helper-xyz | malicious | slopsquat | block | 90 | slopsquat |
| reqeust | malicious | typosquat | allow | 0 |  |
