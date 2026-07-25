# code-style
- Zero comments in any source file including shell scripts and tests. Confidence: 0.90
- Use Biome for code formatting and linting with `biome check --error-on-warnings .`. Confidence: 0.85
- Use TypeScript strict mode. Confidence: 0.80

# testing
- Enforce 100% line and function coverage for all src/ files via bun test --coverage. Confidence: 0.90
- Use dependency injection with fake implementations instead of mocking modules. Confidence: 0.80
- Test shell scripts (install.sh, shim.sh) using Bun.spawnSync in hermetic temp dir sandboxes with controlled PATH. Confidence: 0.70

# cli
- CLI should use exit codes 0 (allow), 10 (warn), 20 (block), 30 (error). Confidence: 0.70

# workflows
- Use make ci as the complete local CI workflow target. Confidence: 0.70
- Prefers fork-based git workflow — pushes go to personal fork's main, not upstream origin/main. Confidence: 0.60

# naming-conventions
- Product name is WNPM, team/org name is Warden. Confidence: 0.75
