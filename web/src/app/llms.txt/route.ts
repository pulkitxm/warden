import { COMMANDS, DOC_PAGES } from "@/lib/docs";
import { absolute, site } from "@/lib/site";

export const dynamic = "force-static";

export function GET(): Response {
  const docs = DOC_PAGES.map(
    (page) =>
      `- [${page.title}](${absolute(`/docs/${page.slug}`)}): ${page.description} Markdown: ${absolute(`/docs/${page.slug}.md`)}`,
  ).join("\n");
  const cli = COMMANDS.map(
    (command) =>
      `- [warden ${command.name}](${absolute(`/docs/cli/${command.name}`)}): ${command.description}. Exit codes: ${command.exitCodes}.`,
  ).join("\n");

  const body = `# ${site.name}

> ${site.description}

Warden is a local-first, deterministic CLI. It never executes package code to analyse it, and the whole test suite runs offline against a fixture registry.

Exit codes are the contract on every command: 0 allow, 10 warn, 20 block, 30 analysis error. Exit 30 means analysis could not complete, which is deliberately distinct from 20.

Structured output goes to stdout, human text to stderr. Run \`warden schema list\` to discover every published report schema, then \`warden schema <name>\` to print one. Prefer reading those schemas over parsing human output.

## Docs

${docs}

## CLI reference

${cli}

## Project

- [Install](${absolute("/install")}): install script, from source, and CI setup.
- [install.sh](${absolute("/install.sh")}): the install script itself, served as plain text.
- [About](${absolute("/about")}): what Warden is and what it deliberately is not.
- [Contact](${absolute("/contact")}): reporting false positives and security issues.
- [Changelog](${absolute("/changelog")}): what has shipped.
- [Source](${site.repo}): MIT licensed.
`;

  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
