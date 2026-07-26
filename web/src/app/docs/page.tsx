import Link from "next/link";
import { DocsPage } from "@/components/docs-page";
import { COMMANDS, DOC_PAGES, DOC_SECTIONS, readingMinutes, SECTION_INTROS } from "@/lib/docs";
import { breadcrumbs, collectionPage, JsonLd, pageMetadata } from "@/lib/seo";

const title = "Documentation";
const description =
  "Everything Warden does, arranged so you can stop reading once you have what you need. Start with three pages, then take the guide that matches your task.";

export const metadata = pageMetadata({ title, description, path: "/docs" });

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const totalMinutes = DOC_PAGES.reduce((sum, page) => sum + readingMinutes(page), 0);

const PATHS = [
  {
    who: "I want the idea, fast",
    minutes: 5,
    steps: ["concepts", "transactions"],
    note: "The model everything else rests on. If you read nothing else, read these two.",
  },
  {
    who: "I am adding this to a project",
    minutes: 8,
    steps: ["getting-started", "interception", "ci"],
    note: "Install it, see what the shims do to your commands, then put the gate on your pull requests.",
  },
  {
    who: "I work with a coding agent",
    minutes: 8,
    steps: ["transactions", "agents", "explain"],
    note: "What a decision means, how to wire up Claude Code or Codex, and how a block becomes a next action.",
  },
  {
    who: "I want to know exactly how it decides",
    minutes: 16,
    steps: ["how-a-verdict-is-reached", "signals-and-scoring", "how-a-plan-is-built"],
    note: "The real code paths, named functions, thresholds, and orderings. Written against the source and fact-checked against it.",
  },
  {
    who: "I am deciding whether to trust it",
    minutes: 9,
    steps: ["coverage", "limitations", "benchmark"],
    note: "What is mediated, what is not, and the measured numbers with the corpus behind them.",
  },
];

function PathCard({ path }: { path: (typeof PATHS)[number] }) {
  return (
    <article className="rounded-2xl border border-white/12 bg-navy-soft/50 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-semibold text-white">{path.who}</h3>
        <span className="shrink-0 font-mono text-[12px] text-mint">{path.minutes} min</span>
      </div>
      <p className="mt-2 text-[14px] leading-relaxed text-fog">{path.note}</p>
      <ol className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
        {path.steps.map((step, index) => {
          const page = DOC_PAGES.find((entry) => entry.slug === step);
          if (!page) return null;
          return (
            <li key={step} className="flex items-center gap-1.5">
              {index > 0 && <span className="text-fog/50">-&gt;</span>}
              <Link
                href={`/docs/${page.slug}`}
                className="rounded-lg border border-white/12 px-2.5 py-1 font-mono text-[12.5px] text-white/85 transition hover:border-mint/40 hover:text-mint"
              >
                {page.title}
              </Link>
            </li>
          );
        })}
      </ol>
    </article>
  );
}

export default function DocsIndexPage() {
  const trail = [
    { name: "Home", path: "/" },
    { name: "Docs", path: "/docs" },
  ];
  const toc = [
    { id: "paths", text: "Where to start" },
    ...DOC_SECTIONS.map((s) => ({ id: slug(s), text: s })),
    { id: "cli", text: "CLI reference" },
  ];

  return (
    <>
      <JsonLd data={[collectionPage({ title, description, path: "/docs" }), breadcrumbs(trail)]} />
      <DocsPage
        trail={trail}
        eyebrow="Overview"
        title={title}
        description={description}
        toc={toc}
        next={{ href: "/docs/concepts", label: "Concepts" }}
      >
        <section>
          <h2 id="paths" className="scroll-mt-24 text-xl font-bold tracking-tight text-white">
            Where to start
          </h2>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-fog">
            All of these docs together are about {totalMinutes} minutes of reading. Almost nobody
            needs all of it. Pick the row that sounds like you.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {PATHS.map((path) => (
              <PathCard key={path.who} path={path} />
            ))}
          </div>
          <p className="mt-5 text-[14.5px] leading-relaxed text-fog">
            Faster than any of them:{" "}
            <code className="font-mono text-white/85">warden plan -- npm install chalk</code>. One
            output shows the graph delta, the execution surface, the analysis coverage, the
            decision, and the next action.
          </p>
        </section>

        {DOC_SECTIONS.map((section) => (
          <section key={section} className="mt-12">
            <h2
              id={slug(section)}
              className="scroll-mt-24 text-xl font-bold tracking-tight text-white"
            >
              {section}
            </h2>
            {SECTION_INTROS[section] && (
              <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-fog">
                {SECTION_INTROS[section]}
              </p>
            )}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {DOC_PAGES.filter((page) => page.section === section).map((page) => (
                <Link
                  key={page.slug}
                  href={`/docs/${page.slug}`}
                  className="rounded-2xl border border-white/12 bg-navy-soft/50 p-5 transition hover:border-mint/40"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="font-semibold text-white">{page.title}</h3>
                    <span className="shrink-0 font-mono text-[12px] text-fog/70">
                      {readingMinutes(page)} min
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-fog">{page.description}</p>
                </Link>
              ))}
            </div>
          </section>
        ))}

        <section className="mt-12">
          <h2 id="cli" className="scroll-mt-24 text-xl font-bold tracking-tight text-white">
            CLI reference
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-fog">
            Generated from the command registry in the source tree, so it cannot drift from the
            binary.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {COMMANDS.map((command) => (
              <Link
                key={command.name}
                href={`/docs/cli/${command.name}`}
                className="rounded-xl border border-white/12 bg-navy-soft/40 px-4 py-3 transition hover:border-mint/40"
              >
                <code className="text-sm font-semibold text-white">warden {command.name}</code>
                <p className="mt-1.5 text-[13px] leading-relaxed text-fog">{command.description}</p>
              </Link>
            ))}
          </div>
        </section>
      </DocsPage>
    </>
  );
}
