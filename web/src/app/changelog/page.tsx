import Link from "next/link";
import { Breadcrumbs } from "@/components/chrome";
import { breadcrumbs, collectionPage, JsonLd, pageMetadata } from "@/lib/seo";
import { META } from "./meta";

export const metadata = pageMetadata({
  title: META.title,
  description: META.description,
  path: "/changelog",
});

const entries = [
  {
    version: "Unreleased",
    items: [
      "warden check lockfile, scripts, and config: eighteen offline rules across the three surfaces a package check cannot see.",
      "warden ci gates on lockfile, install script, and .npmrc changes in the merge-base diff, not only dependency version bumps.",
      "warden doctor reaches parity with wnpm doctor through a shared core, and the doctor report schema is published.",
      "warden schema covers check, ci, audit, doctor, and intent, with warden schema list for discovery.",
      "Unknown verbs suggest the closest real one, -h works everywhere --help does, and --no-color disables ANSI at runtime.",
      "Provenance downgrade, known malware, and slopsquat are called out in human output instead of only appearing in JSON.",
      "cli/main.ts split into per-verb command modules; no domain module imports the CLI layer, enforced by a layering test.",
    ],
  },
  {
    version: "0.1.0",
    items: [
      "warden check, ci, intent, detect, init, fix, config, uninstall, log, schema, completions.",
      "wnpm install and wnpx, vetting before install and before execution.",
      "Dependency doctor: OSV audit, supply-chain gate on candidate fixes, isolated verification, apply with rollback.",
      "Shims for npm, pnpm, yarn, bun, npx, and bunx.",
    ],
  },
];

export default function ChangelogPage() {
  const trail = [
    { name: "Home", path: "/" },
    { name: "Changelog", path: "/changelog" },
  ];
  return (
    <div className="mx-auto max-w-350 px-5 py-12 sm:px-8">
      <JsonLd
        data={[
          collectionPage({
            title: META.title,
            description: META.description,
            path: "/changelog",
          }),
          breadcrumbs(trail),
        ]}
      />
      <article className="max-w-3xl">
        <Breadcrumbs trail={trail} />
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{META.title}</h1>
        <p className="mt-4 text-lg leading-relaxed text-fog">{META.description}</p>

        {entries.map((entry) => (
          <section key={entry.version} className="mt-10">
            <h2 className="text-xl font-bold text-white">{entry.version}</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              {entry.items.map((item) => (
                <li key={item} className="text-[15px] leading-relaxed text-fog">
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ))}

        <p className="mt-10 text-sm text-fog">
          Full history lives in the{" "}
          <Link href="/docs" className="text-mint hover:text-white">
            docs
          </Link>{" "}
          and the repository commit log.
        </p>
      </article>
    </div>
  );
}
