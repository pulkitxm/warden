import Link from "next/link";
import { Breadcrumbs, Prose } from "@/components/chrome";
import { renderMarkdown } from "@/lib/markdown";
import { breadcrumbs, JsonLd, pageMetadata, webPage } from "@/lib/seo";
import { site } from "@/lib/site";
import { META } from "./meta";

export const metadata = pageMetadata({
  title: META.title,
  description: META.description,
  path: "/about",
});

const body = `
## The problem

Two things happened to the JavaScript ecosystem at once.

The supply chain got industrialised. Sonatype counted 454,648 new malicious open-source packages in 2025, and reports that over 99% of open-source malware is on npm. Worms like Shai-Hulud 2.0 self-replicate through install hooks. Maintainers get phished through domains registered days earlier.

And then coding agents started installing packages on our behalf, at machine speed, doing exactly one check: does this name resolve?

Existing tools each solve part of this. None of them solve it together, and the gaps between them are where the interesting attacks live.

## What Warden is

A trust layer that sits **above** per-package-manager settings and **beside** CVE scanners.

- **Before install.** Vet the package: AST capability scan, typosquat distance against real popularity data, curated malware and hallucination intel, and version-to-version diff signals like provenance downgrade.
- **After install.** Audit the surfaces a package check cannot see: where the lockfile resolves from, what runs at install time, which registry holds your token.
- **Repair.** Gate every candidate CVE fix through the same engine, verify survivors in a throwaway workspace, and report a dependency as unfixable rather than upgrading you into a compromised release.
- **For agents.** Structured output, published schemas, stable exit codes, and a handoff bundle carrying both a fix and the command that verifies it.

## What it is not

**Not a runtime sandbox.** Warden never executes package code to analyse it. That is a deliberate trade: it will not catch behaviour that only appears at runtime, and in exchange it cannot be tricked into running the thing it is judging.

**Not a SaaS.** Verdicts are computed locally and deterministically. There is no account, no telemetry, and no service that has to be up for your install to work.

**Not a replacement for CVE scanners.** OSV and the advisory ecosystem are good at what they do, and Warden uses OSV data. What Warden adds is judging the fix.

**Not a general linter or SAST suite.** The scope is trust in what you install and what an agent wrote.

## Design commitments

**Exit codes are an API.** \`0\`, \`10\`, \`20\`, \`30\`, with \`30\` deliberately distinct so a gate never confuses "I could not analyse this" with "this is malicious".

**Never advertise what is not implemented.** If help text names a subcommand, that subcommand exists and is tested.

**Never echo a secret back.** The config audit reports a plaintext token without reprinting it.

**Degrade loudly.** A run that could not audit everything says so in \`notes\` and carries \`audited\` and \`skipped\` counts, rather than reporting a clean result it did not earn.

**Tests are the product.** A security tool with weak tests is a liability. The suite runs offline against a fixture registry, and coverage is enforced at 100%.
`;

export default async function AboutPage() {
  const content = await renderMarkdown(body);
  const trail = [
    { name: "Home", path: "/" },
    { name: "About", path: "/about" },
  ];
  return (
    <div className="mx-auto max-w-350 px-5 py-12 sm:px-8">
      <JsonLd
        data={[
          webPage({ title: META.title, description: META.description, path: "/about" }),
          breadcrumbs(trail),
        ]}
      />
      <article className="max-w-3xl">
        <Breadcrumbs trail={trail} />
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{META.title}</h1>
        <p className="mt-4 text-lg leading-relaxed text-fog">{META.description}</p>
        <hr className="my-8 border-white/10" />
        <Prose>{content}</Prose>
        <p className="mt-10 text-sm text-fog">
          Read the{" "}
          <Link href="/docs/security" className="text-mint hover:text-white">
            threat model
          </Link>
          , the{" "}
          <Link href="/docs/concepts" className="text-mint hover:text-white">
            concepts
          </Link>
          , or{" "}
          <Link href="/docs/install" className="text-mint hover:text-white">
            install it
          </Link>
          . Source on{" "}
          <a
            href={site.repo}
            target="_blank"
            rel="noreferrer"
            className="text-mint hover:text-white"
          >
            GitHub
          </a>
          .
        </p>
      </article>
    </div>
  );
}
