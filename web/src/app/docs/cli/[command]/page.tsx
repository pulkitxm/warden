import Link from "next/link";
import { notFound } from "next/navigation";
import { DocsPage } from "@/components/docs-page";
import { COMMANDS, commandBySlug } from "@/lib/docs";
import { breadcrumbs, JsonLd, pageMetadata, techArticle } from "@/lib/seo";

export function generateStaticParams() {
  return COMMANDS.map((command) => ({ command: command.name }));
}

const GUIDES: Record<string, { href: string; label: string; description: string }> = {
  doctor: {
    href: "/docs/doctor",
    label: "Doctor guide",
    description: "Audit, gate, verify, apply.",
  },
  intent: {
    href: "/docs/intent",
    label: "Intent guide",
    description: "Does the diff match the prompt?",
  },
  ci: { href: "/docs/ci", label: "CI guide", description: "Gating a pull request." },
  check: {
    href: "/docs/check-surfaces",
    label: "Check surfaces",
    description: "Lockfile, scripts, and registry config.",
  },
  schema: {
    href: "/docs/schemas",
    label: "JSON schemas",
    description: "Every published report shape.",
  },
  config: {
    href: "/docs/configuration",
    label: "Configuration",
    description: "Settings, policy, and env vars.",
  },
};

export async function generateMetadata({ params }: { params: Promise<{ command: string }> }) {
  const { command: name } = await params;
  const command = commandBySlug(name);
  if (!command) return {};
  return pageMetadata({
    title: `warden ${command.name}`,
    description: `${command.description}. Flags, exit codes (${command.exitCodes}), and an example.`,
    path: `/docs/cli/${command.name}`,
    type: "article",
  });
}

export default async function CommandPage({ params }: { params: Promise<{ command: string }> }) {
  const { command: name } = await params;
  const command = commandBySlug(name);
  if (!command) notFound();

  const path = `/docs/cli/${command.name}`;
  const trail = [
    { name: "Home", path: "/" },
    { name: "Docs", path: "/docs" },
    { name: "CLI", path: "/docs/cli" },
    { name: command.name, path },
  ];
  const usage = [
    "warden",
    command.name,
    command.positional?.kind,
    ...command.flags.map((flag) => `[${flag.name}${flag.valueHint ? ` ${flag.valueHint}` : ""}]`),
  ]
    .filter(Boolean)
    .join(" ");
  const guide = GUIDES[command.name];
  const index = COMMANDS.findIndex((entry) => entry.name === command.name);
  const previous = COMMANDS[index - 1];
  const next = COMMANDS[index + 1];

  const toc = [
    { id: "usage", text: "Usage" },
    { id: "flags", text: "Flags" },
    ...(command.positional?.values?.length ? [{ id: "values", text: "Accepted values" }] : []),
    { id: "exit-codes", text: "Exit codes" },
    { id: "example", text: "Example" },
  ];

  const related = [
    ...(guide ? [{ href: guide.href, label: guide.label, description: guide.description }] : []),
    {
      href: "/docs/concepts",
      label: "Concepts",
      description: "Verdicts, exit codes, and categories.",
    },
    {
      href: "/docs/agents",
      label: "Agents",
      description: "Driving Warden from a program.",
    },
  ];

  return (
    <>
      <JsonLd
        data={[
          techArticle({
            title: `warden ${command.name}`,
            description: command.description,
            path,
          }),
          breadcrumbs(trail),
        ]}
      />
      <DocsPage
        trail={trail}
        eyebrow="CLI reference"
        title={`warden ${command.name}`}
        description={command.description}
        toc={toc}
        previous={
          previous ? { href: `/docs/cli/${previous.name}`, label: `warden ${previous.name}` } : undefined
        }
        next={next ? { href: `/docs/cli/${next.name}`, label: `warden ${next.name}` } : undefined}
        related={related}
      >
        <section>
          <h2 id="usage" className="scroll-mt-24 text-xl font-bold text-white">
            Usage
          </h2>
          <div className="mt-3 overflow-x-auto rounded-xl border border-white/12 bg-[#070b16] p-4">
            <pre className="font-mono text-[13px] text-[#d7deef]">{usage}</pre>
          </div>
        </section>

        <section className="mt-10">
          <h2 id="flags" className="scroll-mt-24 text-xl font-bold text-white">
            Flags
          </h2>
          <div className="table-scroll mt-3">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border border-white/12 bg-white/5 px-3 py-2 text-left text-white">
                    Flag
                  </th>
                  <th className="border border-white/12 bg-white/5 px-3 py-2 text-left text-white">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody>
                {command.flags.map((flag) => (
                  <tr key={flag.name}>
                    <td className="border border-white/12 px-3 py-2 font-mono whitespace-nowrap text-mint">
                      {flag.name}
                      {flag.valueHint ? ` ${flag.valueHint}` : ""}
                    </td>
                    <td className="border border-white/12 px-3 py-2 text-fog">
                      {flag.description}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {command.positional?.values?.length ? (
          <section className="mt-10">
            <h2 id="values" className="scroll-mt-24 text-xl font-bold text-white">
              Accepted values
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {command.positional.values.map((value) => (
                <li
                  key={value}
                  className="rounded-lg border border-white/12 bg-navy-soft/50 px-3 py-1.5 font-mono text-[13px] text-white"
                >
                  {value}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-10">
          <h2 id="exit-codes" className="scroll-mt-24 text-xl font-bold text-white">
            Exit codes
          </h2>
          <p className="mt-3 font-mono text-sm text-fog">{command.exitCodes}</p>
        </section>

        <section className="mt-10">
          <h2 id="example" className="scroll-mt-24 text-xl font-bold text-white">
            Example
          </h2>
          <div className="mt-3 overflow-x-auto rounded-xl border border-white/12 bg-[#070b16] p-4">
            <pre className="font-mono text-[13px] text-[#d7deef]">
              <span className="text-fog">$ </span>
              {command.example}
            </pre>
          </div>
          <p className="mt-4 text-sm text-fog">
            Every verb also accepts{" "}
            <code className="rounded bg-white/8 px-1.5 py-0.5 text-[12.5px] text-[#ffd9d3]">
              --help
            </code>
            ,{" "}
            <code className="rounded bg-white/8 px-1.5 py-0.5 text-[12.5px] text-[#ffd9d3]">-h</code>
            , and{" "}
            <code className="rounded bg-white/8 px-1.5 py-0.5 text-[12.5px] text-[#ffd9d3]">
              --no-color
            </code>
            . See the{" "}
            <Link href="/docs/cli" className="text-mint hover:text-white">
              reference index
            </Link>
            .
          </p>
        </section>
      </DocsPage>
    </>
  );
}
