import Link from "next/link";
import { Breadcrumbs } from "@/components/chrome";
import { CodeBlock } from "@/components/code";
import { Terminal } from "@/components/terminal";
import { breadcrumbs, JsonLd, pageMetadata, webPage } from "@/lib/seo";
import { site } from "@/lib/site";
import { META } from "./meta";

export const metadata = pageMetadata({
  title: META.title,
  description: META.description,
  path: "/hack",
});

const links = [
  {
    label: "Live deck",
    href: "/presentation/index.html",
    detail: "Slides, in the browser",
    external: true,
  },
  {
    label: "Slide PDF",
    href: "/presentation/warden-deck.pdf",
    detail: "Download",
    external: true,
  },
  {
    label: "Speaker notes",
    href: "/presentation/presentation-context.md",
    detail: "Narrative and timings",
    external: true,
  },
  { label: "Source", href: site.repo, detail: "MIT licensed", external: true },
  { label: "Docs", href: "/docs", detail: "Everything it does", external: false },
];

const numbers = [
  { value: "19.7%", label: "of LLM-recommended packages did not exist", source: "USENIX Security 2025" },
  { value: "796", label: "packages carried the Shai-Hulud 2.0 worm", source: "Datadog, Nov 2025" },
  { value: ">2B", label: "weekly downloads in the chalk/debug hijack", source: "Wiz, Sept 2025" },
  { value: "454,648", label: "new malicious packages in 2025", source: "Sonatype, 2026" },
];

const beats = [
  {
    step: "01",
    title: "One name, twenty-seven packages",
    body: "You type one package. Twenty-six more arrive with it, and exactly one wants to execute code at install time. Checking the name you typed leaves the rest unexamined, which is where a compromised release hides.",
    command: "warden plan -- npm install esbuild",
    output: `Warden plan: npm install esbuild

Graph changes
  + 26 transitive packages
  = 0 unchanged

Execution surface
  1 changed packages carry an install script
  26 platform-specific artifacts will be added

Analysis coverage
  27 of 27 changed packages analyzed (100%)

Decision: NEEDS_APPROVAL
  esbuild@0.28.1 has a postinstall script

Next action
  warden approve-script esbuild@0.28.1 --hook postinstall`,
  },
  {
    step: "02",
    title: "A name that never existed",
    body: "An agent suggests react-codeshift. It sounds right; it conflates two real tools. npm's typosquat protection cannot help, because there is no collision to detect. Warden knows the name.",
    command: "wnpx react-codeshift",
    output: `BLOCK react-codeshift@unknown  risk 90/100
  categories: slopsquat
  slopsquat: this name matches a known LLM hallucination, not a real package
  blocked before any script ran, override with --allow-risky`,
  },
  {
    step: "03",
    title: "A package you already trust",
    body: "chalk is on two billion weekly downloads. In September 2025 its maintainer was phished through npmjs.help and a malicious version was live for about two hours.",
    command: "wnpm install chalk@5.6.1",
    output: `BLOCK chalk@5.6.1  risk 100/100
  categories: known_malware
  known malware: this exact version appears on the compromised-release blocklist`,
  },
  {
    step: "04",
    title: "When the fix is the attack",
    body: "This is the one nothing else covers. The advisory says upgrade. Warden checks the version the advisory recommends, finds a new postinstall hook reaching for child_process and a raw IP, and refuses.",
    command: "warden doctor",
    output: `critical  acme-http@1.0.0 [GHSA-ACME-HTTP-0001]
    request smuggling via keep-alive handling (fixed in 1.0.1)

supply-chain gate on candidate fixes:
  BLOCK acme-http@1.0.1  install_script, exfiltration, provenance_downgrade

UNFIXABLE acme-http: every candidate fix was blocked by the gate

plan minimal: smallest safe upgrade  recommended
  acme-json 2.1.0 -> 2.1.4  patch, in range
  verification: install ok 163ms - test ok 205ms (passed)`,
  },
  {
    step: "05",
    title: "The lockfile nobody reads",
    body: "A pull request that bumps no version at all, only a resolved URL for a transitive dependency. Composition analysis sees no version change and passes it.",
    command: "warden check lockfile",
    output: `BLOCK a@1.0.0  lockfile_lookalike_registry
    resolved from registry.npmjs.help, which impersonates registry.npmjs.org
    fix: repoint this entry and rotate any token that touched that host
exit 20`,
  },
];

export default function HackPage() {
  const trail = [
    { name: "Home", path: "/" },
    { name: "Hackathon", path: "/hack" },
  ];

  return (
    <div className="mx-auto max-w-[1100px] px-5 py-12 sm:px-8">
      <JsonLd
        data={[
          webPage({ title: META.title, description: META.description, path: "/hack" }),
          breadcrumbs(trail),
        ]}
      />
      <Breadcrumbs trail={trail} />

      <p className="text-[13px] font-semibold tracking-[0.16em] text-mint uppercase">
        Hackathon submission
      </p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
        Nothing runs without a verdict.
      </h1>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-fog">
        Warden is a one-go trust layer for npm, pnpm, yarn, and Bun, and for the coding agents that
        install from them. It vets a package before it executes, audits the lockfile and install
        scripts you already have, repairs CVEs through a gate that can reject the official fix, and
        checks that an agent&apos;s diff matches the prompt it was given.
      </p>

      <div className="mt-8 flex flex-wrap gap-2.5">
        {links.map((link) =>
          link.external ? (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="group rounded-xl border border-white/14 bg-navy-soft/50 px-4 py-2.5 transition hover:border-mint/50 hover:bg-mint/10"
            >
              <span className="block text-[14px] font-medium text-white group-hover:text-mint">
                {link.label}
              </span>
              <span className="block text-[12px] text-fog">{link.detail}</span>
            </a>
          ) : (
            <Link
              key={link.label}
              href={link.href}
              className="group rounded-xl border border-white/14 bg-navy-soft/50 px-4 py-2.5 transition hover:border-mint/50 hover:bg-mint/10"
            >
              <span className="block text-[14px] font-medium text-white group-hover:text-mint">
                {link.label}
              </span>
              <span className="block text-[12px] text-fog">{link.detail}</span>
            </Link>
          ),
        )}
      </div>

      <section className="mt-14">
        <h2 className="text-xl font-bold text-white sm:text-2xl">The deck</h2>
        <div className="mt-4 overflow-hidden rounded-2xl border border-white/12 bg-black/40">
          <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
            <iframe
              src="/presentation/index.html"
              title="Warden presentation"
              loading="lazy"
              className="absolute inset-0 h-full w-full"
              allow="fullscreen"
            />
          </div>
        </div>
        <p className="mt-2.5 text-[13px] text-fog">
          Not loading?{" "}
          <a
            href="/presentation/index.html"
            target="_blank"
            rel="noreferrer"
            className="text-mint hover:text-white"
          >
            Open the deck in a new tab
          </a>
          .
        </p>
      </section>

      <section className="mt-14">
        <h2 className="text-xl font-bold text-white sm:text-2xl">Why it exists</h2>
        <div className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {numbers.map((item) => (
            <div key={item.label}>
              <div className="text-2xl font-bold tracking-tight text-coral sm:text-3xl">
                {item.value}
              </div>
              <p className="mt-2 text-[14px] leading-relaxed text-white">{item.label}</p>
              <p className="mt-1 text-[12px] text-fog">{item.source}</p>
            </div>
          ))}
        </div>
        <p className="mt-5 text-[14px] text-fog">
          Every figure is sourced in{" "}
          <a
            href={`${site.repo}/blob/main/research/citations.md`}
            target="_blank"
            rel="noreferrer"
            className="text-mint hover:text-white"
          >
            research/citations.md
          </a>
          , checked against primary and vendor sources. The{" "}
          <Link href="/docs/security" className="text-mint hover:text-white">
            threat model
          </Link>{" "}
          maps each one to the rule it justifies.
        </p>
      </section>

      <section className="mt-14">
        <h2 className="text-xl font-bold text-white sm:text-2xl">Five beats</h2>
        <p className="mt-2 text-[14px] text-fog">
          The first beat is a real install against the public registry. The other four are reproducible offline against the in-repo fixture registry.
        </p>
        <div className="mt-6 space-y-8">
          {beats.map((beat) => (
            <div key={beat.step} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
              <div>
                <span className="font-mono text-[12px] text-mint">{beat.step}</span>
                <h3 className="mt-2 text-lg font-semibold text-white">{beat.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-fog">{beat.body}</p>
                <div className="mt-3">
                  <CodeBlock code={beat.command} lang="bash" />
                </div>
              </div>
              <Terminal output={beat.output} />
            </div>
          ))}
        </div>
      </section>

      <section className="mt-14">
        <h2 className="text-xl font-bold text-white sm:text-2xl">Run it yourself</h2>
        <p className="mt-2 text-[14px] text-fog">
          The whole suite runs offline against a fixture registry. No live malware is downloaded.
        </p>
        <div className="mt-4">
          <CodeBlock
            code={`curl -fsSL https://warden.pulkit.page/install.sh | sh

git clone ${site.repo}
cd warden && make install && bun run build
make doctor-demo     # the gate-blocked fix, offline
make ci              # the full suite`}
            lang="bash"
          />
        </div>
      </section>

      <section className="mt-14 rounded-2xl border border-white/12 bg-navy-soft/50 p-6 sm:p-8">
        <h2 className="text-xl font-bold text-white sm:text-2xl">What is actually built</h2>
        <div className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {[
            ["Dependency transactions", "plan the whole prospective graph, approve, apply, verify, receipt"],
            ["Narrow approvals", "one script, bound to its version, tarball digest, hook, and script body"],
            ["Receipt-gated CI", "warden ci --require-transaction-receipt, the control a bypassed shim cannot skip"],
            ["Deterministic engine", "AST capability scan, typosquat distance, curated intel, version diff"],
            ["Manager-neutral policy", "one policy compiled into npm, pnpm, Yarn, and Bun's own settings"],
            ["Whole-graph interception", "shims for npm, pnpm, yarn, bun, npx, bunx, gated on the full graph"],
            ["Repair loop", "OSV audit, supply-chain gate on the fix, isolated verify, apply"],
            ["Surface audits", "lockfile, install scripts, and .npmrc, across npm, pnpm, and yarn"],
            ["Agent contracts", "capability-based adapters, a read-only MCP manifest, published schemas"],
            ["Intent", "prompt-as-spec verification and hallucinated-API detection"],
            ["Published benchmark", "12 of 12 attack shapes stopped, 0 of 9 benign, reproducible with one command"],
            ["Stated limits", "a Limitations page, a coverage matrix, and analysis coverage on every verdict"],
          ].map(([title, body]) => (
            <div key={title} className="flex gap-2.5">
              <span className="mt-2 block h-1 w-1 shrink-0 rounded-full bg-mint" />
              <p className="text-[14px] leading-relaxed text-fog">
                <span className="font-medium text-white">{title}.</span> {body}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-5 text-[14px] text-fog">
          Local-first and deterministic. Warden never executes package code to analyse it, and there
          is no service that has to be up for your install to work.
        </p>
        <p className="mt-3 text-[14px] text-fog">
          1,418 tests, coverage enforced at 100 percent on every commit. Treat it as a technical
          alpha: graph resolution is flat, failure restores the manifest rather than the whole
          transaction, and receipts are reproducible evidence rather than signed attestations. Those
          limits are written down on the{" "}
          <Link href="/docs/limitations" className="text-mint hover:text-white">
            limitations page
          </Link>{" "}
          rather than left for you to discover.
        </p>
      </section>

      <div className="mt-12 flex flex-wrap gap-3">
        <Link
          href="/docs/install"
          className="rounded-xl bg-coral px-5 py-3 font-semibold text-navy transition hover:bg-white"
        >
          Install Warden
        </Link>
        <Link
          href="/docs/getting-started"
          className="rounded-xl border border-white/20 px-5 py-3 font-semibold text-white transition hover:border-mint hover:text-mint"
        >
          Getting started
        </Link>
      </div>
    </div>
  );
}
