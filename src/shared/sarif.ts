import { ANALYZER_VERSION, type CiFinding } from "../schema.ts";

const SARIF_LEVEL = { block: "error", warn: "warning", allow: "note" } as const;

export const SARIF_SCHEMA_URL = "https://json.schemastore.org/sarif-2.1.0.json";

export function toSarif(findings: CiFinding[], informationUri: string): unknown {
  const rules = new Map<string, { id: string; shortDescription: { text: string } }>();
  for (const finding of findings) {
    if (rules.has(finding.rule)) continue;
    rules.set(finding.rule, {
      id: finding.rule,
      shortDescription: { text: finding.rule.replaceAll("_", " ") },
    });
  }

  return {
    $schema: SARIF_SCHEMA_URL,
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "Warden",
            version: ANALYZER_VERSION,
            informationUri,
            rules: [...rules.values()],
          },
        },
        results: findings.map((finding) => ({
          ruleId: finding.rule,
          level: SARIF_LEVEL[finding.level],
          message: {
            text: `${finding.package}: ${finding.evidence} Fix: ${finding.fix} Verify: ${finding.verify}`,
          },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: finding.file },
                ...(finding.line ? { region: { startLine: finding.line } } : {}),
              },
            },
          ],
        })),
      },
    ],
  };
}
