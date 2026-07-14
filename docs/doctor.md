# Dependency doctor

## What it does

`wnpm doctor` audits direct dependencies, gates possible repairs through the normal package check, builds minimal and latest upgrade plans, verifies each plan in an isolated workspace, then applies the recommended verified plan by default.

## Usage

```text
wnpm doctor [--dir <path>] [--json] [--no-apply] [--no-verify]
```

- `--dir <path>` selects the project directory. The default is `.`.
- `--json` writes the doctor report JSON to stdout.
- `--no-apply` reports and plans only. It does not modify `package.json`.
- `--no-verify` skips isolated-workspace verification of plans.

Exit code `0` means the project is clean or fully fixed. Exit code `10` means unresolved issues remain. Exit code `30` means an error, such as an unreadable `package.json` or a run with nothing auditable.

## What it detects

- OSV vulnerabilities matched against the installed version, including semver ranges and explicit version lists.
- Known-malware blocklist hits.
- Installed versions that fail the supply-chain gate.
- Deprecated latest releases.

## How installed versions are resolved

Doctor reads `node_modules/<name>/package.json` first. It then checks `package-lock.json`, first its `packages` map and then its `dependencies` map. If neither has a version, it assumes the minimum published version satisfying the declared range. `bun.lock` is used only to choose Bun as the install tool, not to resolve versions.

## Candidate selection

Safe upgrades must be published, non-prerelease, strictly newer, and unaffected by every advisory. The minimal plan prefers in-range versions first. The latest plan walks downward from the newest version. Each direction tries at most three candidates, and every candidate goes through the same `checkPackage` engine used by `warden check` and `wnpm install`. If the supply-chain gate blocks the official fix, the dependency is unfixable instead of being upgraded to a compromised release.

## Verification

Doctor copies the project to a temporary workspace, excluding `node_modules`, `.git`, `dist`, and `coverage`. It rewrites `package.json` with exact candidate versions, installs with lifecycle scripts disabled, then runs any existing `test`, `typecheck`, and `build` scripts in that order. It aborts after the first failing step and records timings. The workspace is removed afterwards. Each install or script step has a ten minute timeout.

## Apply

Applying rewrites `package.json` with the exact verified version, which is a pin rather than a range, then reinstalls dependencies. If installation fails, doctor restores the original `package.json`.

## Degraded behavior

Registry or OSV failures skip the affected dependency and add a note. An OSV lookup failure treats vulnerabilities as unknown rather than clean. If nothing can be audited, the report says that the audit is incomplete and exits `30`.

## JSON report

`DoctorReport` contains the following fields.

| Field | Meaning |
| --- | --- |
| `schema_version` | Report schema version. |
| `project` | Project name from `package.json`. |
| `issues` | Detected dependency issues. |
| `gate` | Supply-chain gate results for installed and candidate versions. |
| `unfixable` | Dependencies with no usable safe fix. |
| `plans` | Candidate upgrade plans and verification results. |
| `recommended` | Identifier of the selected plan, when one is available. |
| `applied` | Whether applying the recommended plan succeeded, when attempted. |
| `audited` | Number of dependencies successfully audited. |
| `skipped` | Number of dependencies that could not be audited. |
| `notes` | Degraded-run and operational notes. |

## Trying it

Run `make doctor-demo` to exercise doctor against the in-repo mini registry without network access. Run `make test-doctor` for the focused doctor and CLI test suite.
