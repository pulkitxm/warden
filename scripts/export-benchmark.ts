import { BENCHMARK_CASES } from "../src/benchmark/cases.ts";
import { runBenchmark } from "../src/benchmark/run.ts";
import { ANALYZER_VERSION } from "../src/schema.ts";

const report = await runBenchmark(BENCHMARK_CASES, ANALYZER_VERSION);
const target = new URL("../web/src/lib/benchmark.json", import.meta.url);
await Bun.write(target, `${JSON.stringify(report, null, 2)}\n`);
process.stderr.write(
  `wrote ${report.totals.cases} benchmark cases to web/src/lib/benchmark.json\n`,
);
