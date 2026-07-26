import Link from "next/link";
import { Breadcrumbs } from "@/components/chrome";
import report from "@/lib/benchmark.json";
import { breadcrumbs, JsonLd, pageMetadata } from "@/lib/seo";
import { META } from "./meta";

export const metadata = pageMetadata({
  title: META.title,
  description: META.description,
  path: "/benchmark",
});

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

const DECISION_STYLE: Record<string, string> = {
  allow: "text-mint",
  warn: "text-amber-300",
  needs_approval: "text-amber-300",
  block: "text-coral",
};

export default function BenchmarkPage() {
  const trail = [
    { name: "Home", path: "/" },
    { name: "Benchmark", path: "/benchmark" },
  ];
  const malicious = report.results.filter((result) => result.kind === "malicious");
  const benign = report.results.filter((result) => result.kind === "benign");

  const headline = [
    {
      label: "Detection",
      value: percent(report.detection.rate),
      detail: `${report.detection.caught} of ${report.totals.malicious} malicious shapes stopped`,
    },
    {
      label: "False positives",
      value: percent(report.falsePositives.rate),
      detail: `${report.falsePositives.count} of ${report.totals.benign} benign shapes stopped`,
    },
    {
      label: "Analysis coverage",
      value: percent(report.meanCoverage),
      detail: "mean share of changed packages analyzed",
    },
  ];

  const table = (rows: typeof report.results, caption: string) => (
    <section className="mt-12">
      <h2 className="text-xl font-bold tracking-tight text-white">{caption}</h2>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-white/12">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-white/12 bg-navy-soft/50">
              <th className="px-4 py-3 font-semibold text-white">Case</th>
              <th className="px-4 py-3 font-semibold text-white">Shape</th>
              <th className="px-4 py-3 font-semibold text-white">Decision</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((result) => (
              <tr key={result.id} className="border-b border-white/8 last:border-0">
                <td className="px-4 py-3 align-top font-mono text-[12.5px] text-white/80">
                  {result.id}
                </td>
                <td className="px-4 py-3 align-top text-fog">{result.shape}</td>
                <td className="px-4 py-3 align-top">
                  <span
                    className={`font-mono text-[12.5px] ${DECISION_STYLE[result.actual] ?? "text-fog"}`}
                  >
                    {result.actual}
                  </span>
                  {!result.correct && (
                    <span className="ml-2 font-mono text-[12.5px] text-coral">
                      expected {result.expected}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-12 sm:px-8">
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "Dataset",
            name: `Warden benchmark ${report.analyzer_version}`,
            description: META.description,
            variableMeasured: ["detection rate", "false positive rate", "analysis coverage"],
          },
          breadcrumbs(trail),
        ]}
      />
      <article className="max-w-4xl">
        <Breadcrumbs trail={trail} />
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{META.title}</h1>
        <p className="mt-4 text-lg leading-relaxed text-fog">{META.description}</p>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {headline.map((item) => (
            <div
              key={item.label}
              className="rounded-2xl border border-white/12 bg-navy-soft/50 p-5"
            >
              <p className="text-[12.5px] font-semibold tracking-[0.14em] text-mint uppercase">
                {item.label}
              </p>
              <p className="mt-2 text-3xl font-bold text-white">{item.value}</p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-fog">{item.detail}</p>
            </div>
          ))}
        </div>

        <p className="mt-6 text-sm leading-relaxed text-fog">
          Analyzer <span className="font-mono text-white/80">{report.analyzer_version}</span>,{" "}
          {report.totals.cases} cases. Reproduce it with{" "}
          <code className="font-mono text-white/80">warden benchmark --json</code>, which runs the
          same corpus through the same engine and exits non-zero if any case regresses.
        </p>

        {table(malicious, "Attack shapes")}
        {table(benign, "Benign shapes")}

        <section className="mt-12 rounded-2xl border border-white/12 bg-navy-soft/50 p-6">
          <h2 className="text-lg font-semibold text-white">How these numbers are produced</h2>
          <ul className="mt-3 space-y-2 text-[14.5px] leading-relaxed text-fog">
            {report.method.map((note) => (
              <li key={note} className="flex gap-2.5">
                <span className="mt-2 block h-1 w-1 shrink-0 rounded-full bg-mint" />
                {note}
              </li>
            ))}
          </ul>
        </section>

        <p className="mt-10 text-sm text-fog">
          Read the{" "}
          <Link href="/docs/limitations" className="text-mint hover:text-white">
            limitations
          </Link>{" "}
          before reading anything into these rates, and{" "}
          <Link href="/docs/transactions" className="text-mint hover:text-white">
            transactions
          </Link>{" "}
          for what a decision means.
        </p>
      </article>
    </div>
  );
}
