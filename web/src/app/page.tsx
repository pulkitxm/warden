import Link from "next/link";
import { Checkpoint } from "@/components/checkpoint";
import { CodeBlock } from "@/components/code";
import { Terminal } from "@/components/terminal";
import { TryIt } from "@/components/try-it";
import { Reveal } from "@/components/reveal";
import { pageMetadata } from "@/lib/seo";
import { site } from "@/lib/site";

export const metadata = pageMetadata({
  title: site.tagline,
  description: site.description,
  path: "/",
});

const managers = ["npm", "pnpm", "yarn", "bun", "npx", "bunx"];

const problems = [
  {
    index: "01",
    title: "Names deceive",
    body: "One swapped character, a lookalike glyph, or a package name an LLM invented turns a routine command into code execution. There is no collision to detect when the name never existed.",
  },
  {
    index: "02",
    title: "Trust changes",
    body: "A familiar package can add a lifecycle script, change maintainers, or abandon its trusted publisher flow in a single release. The manifest barely moves.",
  },
  {
    index: "03",
    title: "Scripts run early",
    body: "Install hooks execute before you inspect anything. By the time a scanner reports the problem, the payload has already had control.",
  },
];

const pillars = [
  {
    title: "Vet before it runs",
    body: "An AST capability scan, typosquat distance against real popularity data, curated malware and hallucination intel, and version-to-version diff signals. Blocked means nothing ran.",
    href: "/docs/concepts",
    cta: "How verdicts work",
  },
  {
    title: "Repair without trusting the fix",
    body: "Doctor audits against OSV, then runs every candidate fix through the same engine. If the officially advised version is itself compromised, the dependency is reported unfixable instead of upgraded.",
    href: "/docs/doctor",
    cta: "Doctor",
  },
  {
    title: "Audit your own repository",
    body: "The lockfile decides where code is fetched from, install scripts decide what runs, and .npmrc decides which registry holds your token. All three are audited offline.",
    href: "/docs/check-surfaces",
    cta: "Check surfaces",
  },
  {
    title: "Built for agents",
    body: "JSON on stdout, human text on stderr, published schemas for every report, stable exit codes, and a handoff bundle carrying both a fix and the command that verifies it.",
    href: "/docs/agents",
    cta: "Agent playbook",
  },
];

const facts = [
  {
    value: "19.7%",
    label: "of LLM-recommended packages did not exist",
    source: "USENIX Security 2025",
  },
  { value: "796", label: "packages carried the Shai-Hulud 2.0 worm", source: "Datadog, Nov 2025" },
  {
    value: ">2B",
    label: "weekly downloads hit by the chalk/debug hijack",
    source: "Wiz, Sept 2025",
  },
  { value: ">99%", label: "of open-source malware is on npm", source: "Sonatype, 2026" },
];

const doctorSample = `2 issue(s) found, 2 affect production
  critical  acme-http@1.0.0 [GHSA-ACME-HTTP-0001]
    request smuggling via keep-alive handling (fixed in 1.0.1)

supply-chain gate on candidate fixes:
  BLOCK acme-http@1.0.1  install_script, exfiltration, provenance_downgrade

UNFIXABLE acme-http: every candidate fix was blocked by the gate

plan minimal: smallest safe upgrade  recommended
  acme-json 2.1.0 -> 2.1.4  patch, in range
  verification: install ok 163ms - test ok 205ms (passed)`;

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-white/10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_450px_at_85%_-10%,rgba(79,209,165,0.16),transparent),radial-gradient(700px_400px_at_0%_110%,rgba(255,107,91,0.14),transparent)]"
        />
        <div className="relative mx-auto max-w-[1400px] px-5 py-16 sm:px-8 lg:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
            <div>
              <p className="inline-flex items-center gap-2 text-[12.5px] font-semibold tracking-[0.16em] text-mint uppercase">
                <span className="block h-1.5 w-1.5 rounded-full bg-mint" />
                Package trust, before execution
              </p>
              <h1 className="mt-5 text-4xl leading-[1.05] font-bold tracking-tight text-white sm:text-5xl lg:text-[3.4rem]">
                Nothing runs
                <br />
                without a <em className="text-coral not-italic">verdict.</em>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-fog">
                Warden checks a package before it installs or executes. It verifies the artifact,
                reads what changed between versions, scans the code, and stops a risky release
                before a lifecycle script ever gets control.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/install"
                  className="rounded-xl bg-coral px-5 py-3 font-semibold text-navy transition hover:bg-white"
                >
                  Protect this machine
                </Link>
                <Link
                  href="/docs/getting-started"
                  className="rounded-xl border border-white/20 px-5 py-3 font-semibold text-white transition hover:border-mint hover:text-mint"
                >
                  Getting started
                </Link>
              </div>
              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2.5 text-[13px] text-fog">
                {["Deterministic verdicts", "Stable exit codes", "Evidence in every result"].map(
                  (item) => (
                    <span key={item} className="flex items-center gap-2">
                      <span className="block h-1 w-1 rounded-full bg-mint" />
                      {item}
                    </span>
                  ),
                )}
              </div>
            </div>

            <Checkpoint />
          </div>

          <div>
            <div className="mt-14 flex flex-col gap-4 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-mono text-[11px] tracking-[0.1em] text-fog uppercase">
                Keep the command you already use
              </span>
              <div className="flex flex-wrap gap-x-7 gap-y-2">
                {managers.map((manager) => (
                  <b key={manager} className="font-mono text-[13px] font-semibold text-white/80">
                    {manager}
                  </b>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1400px] px-5 py-20 sm:px-8">
        <Reveal>
          <p className="text-[12.5px] font-semibold tracking-[0.16em] text-mint uppercase">
            The missing checkpoint
          </p>
          <h2 className="mt-4 max-w-3xl text-2xl font-bold tracking-tight text-white sm:text-3xl">
            A package manager answers <em className="text-fog not-italic">can I install this?</em>{" "}
            Warden asks <em className="text-coral not-italic">should this run?</em>
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {problems.map((problem, position) => (
            <Reveal key={problem.index} delay={position * 90}>
              <article className="h-full rounded-2xl border border-white/12 bg-navy-soft/50 p-6">
                <span className="font-mono text-[12px] text-mint">{problem.index}</span>
                <h3 className="mt-3 text-lg font-semibold text-white">{problem.title}</h3>
                <p className="mt-2.5 text-[15px] leading-relaxed text-fog">{problem.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1400px] px-5 pb-20 sm:px-8">
        <Reveal>
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Try a verdict
          </h2>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-fog">
            Real verdicts from the offline fixture registry the test suite runs against. Nothing
            here contacts npm, and no live malware is involved.
          </p>
          <div className="mt-6 max-w-3xl">
            <TryIt />
          </div>
        </Reveal>
      </section>

      <section className="mx-auto max-w-[1400px] px-5 pb-20 sm:px-8">
        <Reveal>
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Four jobs, one tool
          </h2>
        </Reveal>
        <div className="mt-9 grid gap-5 md:grid-cols-2">
          {pillars.map((pillar, position) => (
            <Reveal key={pillar.title} delay={position * 80}>
              <div className="h-full rounded-2xl border border-white/12 bg-navy-soft/50 p-6 transition hover:border-mint/40">
                <h3 className="text-lg font-semibold text-white">{pillar.title}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-fog">{pillar.body}</p>
                <Link
                  href={pillar.href}
                  className="mt-4 inline-block text-sm font-medium text-mint transition hover:text-white"
                >
                  {pillar.cta} →
                </Link>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="border-y border-white/10 bg-navy-soft/30">
        <div className="mx-auto max-w-[1400px] px-5 py-16 sm:px-8">
          <Reveal>
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Why this exists
            </h2>
          </Reveal>
          <div className="mt-9 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {facts.map((fact, position) => (
              <Reveal key={fact.label} delay={position * 70}>
                <div className="text-3xl font-bold tracking-tight text-coral">{fact.value}</div>
                <p className="mt-2 text-[15px] leading-relaxed text-white">{fact.label}</p>
                <p className="mt-1 text-[13px] text-fog">{fact.source}</p>
              </Reveal>
            ))}
          </div>
          <Reveal delay={280}>
            <Link
              href="/docs/security"
              className="mt-8 inline-block text-sm font-medium text-mint transition hover:text-white"
            >
              Read the threat model, with sources →
            </Link>
          </Reveal>
        </div>
      </section>

      <section className="mx-auto max-w-[1400px] px-5 py-20 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <Reveal>
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              The case nothing else covers
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-fog">
              An advisory tells you to upgrade. Automated bump tooling raises the PR.{" "}
              <code className="rounded bg-white/8 px-1.5 py-0.5 font-mono text-[13px] text-[#ffd9d3]">
                npm audit fix --force
              </code>{" "}
              applies it. None of them check whether the version being recommended is safe.
            </p>
            <p className="mt-4 text-[15px] leading-relaxed text-fog">
              Warden runs the fix through the same engine as any other package, and verifies the
              survivor in a throwaway workspace against your own tests before touching your
              manifest.
            </p>
            <Link
              href="/docs/doctor"
              className="mt-5 inline-block text-sm font-medium text-mint transition hover:text-white"
            >
              How doctor works →
            </Link>
          </Reveal>
          <Reveal delay={120}>
            <Terminal output={doctorSample} />
          </Reveal>
        </div>
      </section>

      <section className="mx-auto max-w-[1400px] px-5 pb-24 sm:px-8">
        <Reveal>
          <div className="rounded-3xl border border-white/12 bg-navy-soft/50 p-8 sm:p-12">
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Install once, keep your habits
            </h2>
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-fog">
              Shims sit in front of the package managers you already use, so nothing about how you
              type changes.
            </p>
            <div className="mt-6 max-w-2xl">
              <CodeBlock
                code={"curl -fsSL https://warden.pulkit.page/install.sh | sh"}
                lang="bash"
              />
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/install"
                className="rounded-xl bg-coral px-5 py-3 font-semibold text-navy transition hover:bg-white"
              >
                Install guide
              </Link>
              <Link
                href="/docs"
                className="rounded-xl border border-white/20 px-5 py-3 font-semibold text-white transition hover:border-mint hover:text-mint"
              >
                Read the docs
              </Link>
            </div>
          </div>
        </Reveal>
      </section>
    </>
  );
}
