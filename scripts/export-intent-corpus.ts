import { CORPUS_CASES } from "../src/intent/corpus/cases.ts";
import { runCorpus } from "../src/intent/corpus/run.ts";
import { ANALYZER_VERSION } from "../src/schema.ts";

const report = await runCorpus(CORPUS_CASES, ANALYZER_VERSION);
const target = new URL("../web/src/lib/intent-corpus.json", import.meta.url);
await Bun.write(target, `${JSON.stringify(report, null, 2)}\n`);
process.stderr.write(
  `wrote ${report.totals.cases} intent corpus cases to web/src/lib/intent-corpus.json\n`,
);
