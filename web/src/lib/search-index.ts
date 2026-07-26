import { COMMANDS, DOC_PAGES, SECTION_INTROS } from "./docs";
import type { SearchRecord } from "./search";
import { slugify } from "./slug";

const SAMPLE_FENCES = new Set(["term", "text", "console", "shell-session"]);
const MAX_TEXT = 900;

interface Block {
  heading: string | null;
  lines: string[];
}

function inlineText(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/^\s*\|?\s*:?-{3,}[-\s|:]*$/, " ")
    .replace(/\|/g, " ")
    .replace(/[`*>]/g, "");
}

function cleanText(lines: string[]): string {
  const parts: string[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const opening = line.match(/^\s*```(\S*)/);
    if (opening) {
      fence = fence === null ? opening[1] || "plain" : null;
      continue;
    }
    if (fence !== null && SAMPLE_FENCES.has(fence)) continue;
    parts.push(inlineText(line));
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function truncate(value: string): string {
  if (value.length <= MAX_TEXT) return value;
  const slice = value.slice(0, MAX_TEXT);
  const index = slice.lastIndexOf(" ");
  return index > MAX_TEXT / 2 ? slice.slice(0, index) : slice;
}

function blocksOf(body: string): Block[] {
  const blocks: Block[] = [];
  let current: Block = { heading: null, lines: [] };
  let inFence = false;

  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const heading = inFence ? null : line.match(/^(#{2,3})\s+(.+)$/);
    if (heading) {
      blocks.push(current);
      current = { heading: heading[2].trim().replace(/`/g, ""), lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  blocks.push(current);
  return blocks;
}

function buildSearchIndex(): SearchRecord[] {
  const records: SearchRecord[] = [];

  records.push({
    id: "docs",
    kind: "page",
    title: "Documentation",
    page: "Documentation",
    section: "Overview",
    path: "/docs",
    text: `Every page Warden documents, grouped by section. ${Object.values(SECTION_INTROS).join(" ")}`,
    keywords: "docs index overview contents home start",
  });

  records.push({
    id: "docs/cli",
    kind: "page",
    title: "CLI reference",
    page: "CLI reference",
    section: "CLI",
    path: "/docs/cli",
    text: `Every verb Warden ships, generated from the command registry. ${COMMANDS.map((command) => command.name).join(" ")}`,
    keywords: "cli commands reference verbs flags usage",
  });

  for (const page of DOC_PAGES) {
    const blocks = blocksOf(page.body);
    const lead = blocks.find((block) => block.heading === null);

    records.push({
      id: page.slug,
      kind: "page",
      title: page.title,
      page: page.title,
      section: page.section,
      path: `/docs/${page.slug}`,
      text: truncate(`${page.description} ${lead ? cleanText(lead.lines) : ""}`.trim()),
      keywords: `${page.slug.replace(/-/g, " ")} ${page.slug} ${page.section} ${(page.related ?? []).join(" ")}`,
    });

    const anchors = new Map<string, number>();
    for (const block of blocks) {
      if (block.heading === null) continue;
      const base = slugify(block.heading);
      const seen = anchors.get(base) ?? 0;
      anchors.set(base, seen + 1);
      const anchor = seen === 0 ? base : `${base}-${seen}`;
      const text = cleanText(block.lines);
      if (text.length === 0) continue;

      records.push({
        id: `${page.slug}#${anchor}`,
        kind: "section",
        title: block.heading,
        page: page.title,
        section: page.section,
        path: `/docs/${page.slug}#${anchor}`,
        text: truncate(text),
        keywords: `${page.slug.replace(/-/g, " ")} ${page.slug}`,
      });
    }
  }

  for (const command of COMMANDS) {
    const flags = command.flags.map((flag) => `${flag.name} ${flag.description}`).join(" ");
    records.push({
      id: `cli/${command.name}`,
      kind: "command",
      title: `warden ${command.name}`,
      page: "CLI reference",
      section: "CLI",
      path: `/docs/cli/${command.name}`,
      text: truncate(
        `${command.description} ${command.example} Exit codes: ${command.exitCodes} ${flags}`,
      ),
      keywords: [
        command.name,
        `wnpm ${command.name}`,
        ...command.flags.map((flag) => flag.name),
        ...(command.positional?.values ?? []),
      ].join(" "),
    });
  }

  return records;
}

export const SEARCH_INDEX: SearchRecord[] = buildSearchIndex();
