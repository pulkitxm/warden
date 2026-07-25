import Link from "next/link";
import { DocsPage } from "@/components/docs-page";
import { COMMANDS, DOC_PAGES, DOC_SECTIONS } from "@/lib/docs";
import { breadcrumbs, collectionPage, JsonLd, pageMetadata } from "@/lib/seo";

const title = "Documentation";
const description =
  "Everything Warden does: getting started, concepts, the CLI reference, doctor, intent, CI, check surfaces, agent integration, and the threat model behind each rule.";

export const metadata = pageMetadata({ title, description, path: "/docs" });

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export default function DocsIndexPage() {
  const trail = [
    { name: "Home", path: "/" },
    { name: "Docs", path: "/docs" },
  ];
  const toc = [...DOC_SECTIONS.map((s) => ({ id: slug(s), text: s })), { id: "cli", text: "CLI reference" }];
  const first = DOC_PAGES[0];

  return (
    <>
      <JsonLd
        data={[collectionPage({ title, description, path: "/docs" }), breadcrumbs(trail)]}
      />
      <DocsPage
        trail={trail}
        eyebrow="Overview"
        title={title}
        description={description}
        toc={toc}
        next={first ? { href: `/docs/${first.slug}`, label: first.title } : undefined}
      >
        {DOC_SECTIONS.map((section) => (
          <section key={section} className="mt-10 first:mt-0">
            <h2
              id={slug(section)}
              className="scroll-mt-24 text-xl font-bold tracking-tight text-white"
            >
              {section}
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {DOC_PAGES.filter((page) => page.section === section).map((page) => (
                <Link
                  key={page.slug}
                  href={`/docs/${page.slug}`}
                  className="rounded-2xl border border-white/12 bg-navy-soft/50 p-5 transition hover:border-mint/40"
                >
                  <h3 className="font-semibold text-white">{page.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-fog">{page.description}</p>
                </Link>
              ))}
            </div>
          </section>
        ))}

        <section className="mt-10">
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
