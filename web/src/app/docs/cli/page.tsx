import Link from "next/link";
import { DocsPage } from "@/components/docs-page";
import { COMMANDS } from "@/lib/docs";
import { breadcrumbs, collectionPage, JsonLd, pageMetadata } from "@/lib/seo";

const title = "CLI reference";
const description =
  "Every warden verb with its flags, exit codes, and an example. Generated from the command registry in the source tree, so it cannot drift from the binary.";

export const metadata = pageMetadata({ title, description, path: "/docs/cli" });

const binaries = [
  { name: "warden", body: "The multi-verb CLI. Everything below is a warden verb." },
  {
    name: "wnpm",
    body: "Install wrapper. wnpm install vets every package in parallel and refuses if any verdict is block. wnpm doctor shares its core with warden doctor.",
  },
  {
    name: "wnpx",
    body: "Execution wrapper. Vets before running, which is where npx and bunx are most dangerous. --schema prints the verdict schema.",
  },
];

const exitCodes = [
  ["0", "allow"],
  ["10", "warn"],
  ["20", "block"],
  ["30", "analysis error"],
];

export default function CliIndexPage() {
  const trail = [
    { name: "Home", path: "/" },
    { name: "Docs", path: "/docs" },
    { name: "CLI", path: "/docs/cli" },
  ];
  const first = COMMANDS[0];

  return (
    <>
      <JsonLd
        data={[collectionPage({ title, description, path: "/docs/cli" }), breadcrumbs(trail)]}
      />
      <DocsPage
        trail={trail}
        eyebrow="Reference"
        title={title}
        description={description}
        toc={[
          { id: "binaries", text: "Binaries" },
          { id: "exit-codes", text: "Exit codes" },
          { id: "verbs", text: "Verbs" },
        ]}
        next={first ? { href: `/docs/cli/${first.name}`, label: `warden ${first.name}` } : undefined}
        related={[
          { href: "/docs/concepts", label: "Concepts", description: "Verdicts, exit codes, categories." },
          { href: "/docs/agents", label: "Agents", description: "Driving Warden from a program." },
        ]}
      >
        <section>
          <h2 id="binaries" className="scroll-mt-24 text-xl font-bold text-white">
            Binaries
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {binaries.map((binary) => (
              <div
                key={binary.name}
                className="rounded-2xl border border-white/12 bg-navy-soft/50 p-5"
              >
                <code className="text-sm font-semibold text-mint">{binary.name}</code>
                <p className="mt-2 text-[13px] leading-relaxed text-fog">{binary.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <h2 id="exit-codes" className="scroll-mt-24 text-xl font-bold text-white">
            Exit codes
          </h2>
          <div className="table-scroll mt-4 max-w-md">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border border-white/12 bg-white/5 px-3 py-2 text-left text-white">
                    Code
                  </th>
                  <th className="border border-white/12 bg-white/5 px-3 py-2 text-left text-white">
                    Meaning
                  </th>
                </tr>
              </thead>
              <tbody>
                {exitCodes.map(([code, meaning]) => (
                  <tr key={code}>
                    <td className="border border-white/12 px-3 py-2 font-mono text-mint">{code}</td>
                    <td className="border border-white/12 px-3 py-2 text-fog">{meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-10">
          <h2 id="verbs" className="scroll-mt-24 text-xl font-bold text-white">
            Verbs
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {COMMANDS.map((command) => (
              <Link
                key={command.name}
                href={`/docs/cli/${command.name}`}
                className="rounded-xl border border-white/12 bg-navy-soft/40 p-4 transition hover:border-mint/40"
              >
                <code className="font-semibold text-white">warden {command.name}</code>
                <p className="mt-1.5 text-[13px] leading-relaxed text-fog">
                  {command.description}
                </p>
              </Link>
            ))}
          </div>
        </section>
      </DocsPage>
    </>
  );
}
