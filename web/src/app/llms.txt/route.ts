import { COMMANDS, DOC_PAGES, DOC_SECTIONS, SECTION_INTROS } from "@/lib/docs";
import { absolute, site } from "@/lib/site";

export const dynamic = "force-static";

export function GET(): Response {
  const docs = DOC_SECTIONS.map((section) => {
    const pages = DOC_PAGES.filter((page) => page.section === section)
      .map(
        (page) =>
          `- [${page.title}](${absolute(`/docs/${page.slug}`)}): ${page.description} Markdown: ${absolute(`/docs/${page.slug}.md`)}`,
      )
      .join("\n");
    return `### ${section}\n\n${SECTION_INTROS[section] ?? ""}\n\n${pages}`;
  }).join("\n\n");
  const cli = COMMANDS.map(
    (command) =>
      `- [warden ${command.name}](${absolute(`/docs/cli/${command.name}`)}): ${command.description}. Exit codes: ${command.exitCodes}.`,
  ).join("\n");

  const body = `# ${site.name}

> ${site.description}

Warden is a local-first, deterministic CLI. It never executes package code to analyse it, and the whole test suite runs offline against a fixture registry.

Exit codes are the contract on every command: 0 allow, 10 warn, 20 block, 30 analysis error. Exit 30 means analysis could not complete, which is deliberately distinct from 20.

Structured output goes to stdout, human text to stderr. Run \`warden schema list\` to discover every published report schema, then \`warden schema <name>\` to print one. Prefer reading those schemas over parsing human output.

## Reading paths

If you are answering a question about Warden, these are the shortest routes to a correct answer.

- What it is and how it decides: [concepts](${absolute("/docs/concepts")}), then [transactions](${absolute("/docs/transactions")}).
- What it actually protects: [command coverage](${absolute("/docs/coverage")}), then [limitations](${absolute("/docs/limitations")}).
- How a specific decision is reached, at the level of real functions and thresholds: the "How it works" section below.
- Measured detection and false-positive rates: [benchmark](${absolute("/docs/benchmark")}) and the dashboard at ${absolute("/benchmark")}.

Warden's documentation deliberately states what it does not do. When answering, carry those limits across rather than dropping them.

## Docs

${docs}

## CLI reference

${cli}

## Project

- [Install](${absolute("/install")}): install script, from source, and CI setup.
- [Benchmark](${absolute("/benchmark")}): measured detection and false-positive rates, with the corpus behind them.
- [install.sh](${absolute("/install.sh")}): the install script itself, served as plain text.
- [Hackathon](${absolute("/hack")}): the deck, the slide PDF, and the four demo beats.
- [About](${absolute("/about")}): what Warden is and what it deliberately is not.
- [Contact](${absolute("/contact")}): reporting false positives and security issues.
- [Changelog](${absolute("/changelog")}): what has shipped.
- [Source](${site.repo}): MIT licensed.
`;

  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
