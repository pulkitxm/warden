import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CHECK_SURFACES } from "../src/cli/commands/check.ts";
import { COMMAND_REGISTRY } from "../src/cli/registry.ts";
import { DEFAULT_POLICY } from "../src/policy/compile.ts";
import { AGENT_NAMES } from "../src/shared/agents.ts";
import { COVERAGE_MATRIX, UNSUPPORTED_PATHS } from "../src/shim/grammar.ts";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const siteDocs = read("../web/src/lib/docs.ts");
const commandNotes = read("../web/src/lib/command-notes.ts");
const featuresDoc = read("../docs/features.md");
const surfacesDoc = read("../docs/check-surfaces.md");
const configDoc = read("../docs/config.md");

const CI_REPORTERS = ["summary", "json", "github", "agent", "sarif"];
const LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"];

test("every public verb has a page on the site and a written overview", () => {
  for (const command of COMMAND_REGISTRY.filter((entry) => !entry.hidden)) {
    const declared =
      commandNotes.includes(`  ${command.name}: {`) ||
      commandNotes.includes(`  "${command.name}": {`);
    expect(`${command.name}: ${declared}`).toBe(`${command.name}: true`);
  }
});

test("every ci reporter the CLI accepts is documented on the site", () => {
  for (const reporter of CI_REPORTERS) {
    expect(siteDocs).toContain(reporter);
  }
});

test("the reporter list in the registry matches the documented reporters", () => {
  const ci = COMMAND_REGISTRY.find((entry) => entry.name === "ci");
  const hint = ci?.flags.find((flag) => flag.name === "--reporter")?.valueHint ?? "";
  for (const reporter of CI_REPORTERS) expect(hint).toContain(reporter);
});

test("every check surface is documented in the repo and on the site", () => {
  for (const surface of CHECK_SURFACES) {
    expect(surfacesDoc).toContain(`check ${surface}`);
    expect(featuresDoc).toContain(`check ${surface}`);
    expect(siteDocs).toContain(`check ${surface}`);
  }
});

test("every lockfile format the audit parses is named in the docs", () => {
  for (const file of LOCKFILES) {
    expect(surfacesDoc).toContain(file);
    expect(siteDocs).toContain(file);
  }
});

test("every agent adapter is documented where the setting is explained", () => {
  for (const name of AGENT_NAMES) {
    expect(configDoc).toContain(name);
    expect(siteDocs).toContain(name);
  }
});

test("the global flags are documented on the site", () => {
  for (const flag of ["--json", "--no-color", "--quiet", "--verbose"]) {
    expect(siteDocs).toContain(flag);
  }
});

test("docs do not claim an unimplemented check surface", () => {
  const claimed = [...surfacesDoc.matchAll(/warden check (\w+)/g)].map(
    (match) => match[1] as string,
  );
  for (const surface of claimed) {
    expect([...CHECK_SURFACES, "lockfile", "scripts", "config"]).toContain(surface);
  }
});

test("every mediated command form appears on the coverage page", () => {
  for (const row of COVERAGE_MATRIX) {
    if (row.command.startsWith("<")) continue;
    expect(siteDocs).toContain(`${row.manager} ${row.command}`);
  }
});

test("every unsupported path is named on the site, not only in the binary", () => {
  for (const entry of UNSUPPORTED_PATHS) {
    expect(siteDocs).toContain(entry.path);
  }
});

test("every policy key the compiler accepts is documented on the site", () => {
  for (const key of Object.keys(DEFAULT_POLICY)) {
    expect(siteDocs).toContain(key);
  }
});

test("the limitations page states the boundary the report asked for", () => {
  for (const claim of [
    "not an operating-system control",
    "cannot prove that code is safe",
    "flat: one version per package name",
    "No model decides a block",
  ]) {
    expect(siteDocs).toContain(claim);
  }
});

test("the site content modules actually parse, so a broken page cannot reach the deploy", async () => {
  const docs = await import("../web/src/lib/docs.ts");
  const notes = await import("../web/src/lib/command-notes.ts");
  expect(docs.DOC_PAGES.length).toBeGreaterThan(10);
  expect(Object.keys(notes.COMMAND_NOTES).length).toBeGreaterThan(10);
});

test("every doc page has a slug, a title, a description, and a body", async () => {
  const { DOC_PAGES } = await import("../web/src/lib/docs.ts");
  for (const page of DOC_PAGES) {
    expect(`${page.slug} title`).not.toBe(" title");
    expect(page.description.length).toBeGreaterThan(20);
    expect(page.body.length).toBeGreaterThan(200);
  }
});

test("every doc page body closes the template literal it opened", async () => {
  const { DOC_PAGES } = await import("../web/src/lib/docs.ts");
  for (const page of DOC_PAGES) {
    const backticks = (page.body.match(/`/g) ?? []).length;
    expect(`${page.slug}: ${backticks % 2 === 0}`).toBe(`${page.slug}: true`);
  }
});

test("every command note points at commands that exist", async () => {
  const { COMMAND_NOTES } = await import("../web/src/lib/command-notes.ts");
  const known = new Set(COMMAND_REGISTRY.map((entry) => entry.name));
  for (const name of Object.keys(COMMAND_NOTES)) {
    expect(`${name} is a real verb: ${known.has(name)}`).toBe(`${name} is a real verb: true`);
  }
});

test("the published benchmark matches what the binary produces today", async () => {
  const { BENCHMARK_CASES } = await import("../src/benchmark/cases.ts");
  const { runBenchmark } = await import("../src/benchmark/run.ts");
  const published = await import("../web/src/lib/benchmark.json");
  const fresh = await runBenchmark(BENCHMARK_CASES, published.default.analyzer_version);
  expect(fresh.totals).toEqual(published.default.totals);
  expect(fresh.detection).toEqual(published.default.detection);
  expect(fresh.falsePositives).toEqual(published.default.falsePositives);
  expect(fresh.results.map((row) => `${row.id}:${row.actual}`)).toEqual(
    published.default.results.map((row) => `${row.id}:${row.actual}`),
  );
});

test("every doc page belongs to a declared section", async () => {
  const { DOC_PAGES, DOC_SECTIONS } = await import("../web/src/lib/docs.ts");
  for (const page of DOC_PAGES) {
    expect(`${page.slug}: ${DOC_SECTIONS.includes(page.section as never)}`).toBe(
      `${page.slug}: true`,
    );
  }
});

test("every section has pages and an introduction, so none renders as a bare heading", async () => {
  const { DOC_PAGES, DOC_SECTIONS, SECTION_INTROS } = await import("../web/src/lib/docs.ts");
  for (const section of DOC_SECTIONS) {
    expect(`${section}: ${DOC_PAGES.some((page) => page.section === section)}`).toBe(
      `${section}: true`,
    );
    expect(`${section}: ${Boolean(SECTION_INTROS[section])}`).toBe(`${section}: true`);
  }
});

test("the page order covers every page exactly once, so none falls to the end silently", async () => {
  const { DOC_PAGES } = await import("../web/src/lib/docs.ts");
  const slugs = DOC_PAGES.map((page) => page.slug);
  expect(new Set(slugs).size).toBe(slugs.length);
  const sections = DOC_PAGES.map((page) => page.section);
  const firstIndex = new Map<string, number>();
  sections.forEach((section, index) => {
    if (!firstIndex.has(section)) firstIndex.set(section, index);
  });
  const grouped = sections.every(
    (section, index) =>
      index === 0 ||
      section === sections[index - 1] ||
      !firstIndex.has(section) ||
      firstIndex.get(section) === index,
  );
  expect(grouped).toBe(true);
});

test("every related link points at a page that exists", async () => {
  const { DOC_PAGES } = await import("../web/src/lib/docs.ts");
  const slugs = new Set(DOC_PAGES.map((page) => page.slug));
  for (const page of DOC_PAGES) {
    for (const related of page.related ?? []) {
      if (related === "cli") continue;
      expect(`${page.slug} -> ${related}: ${slugs.has(related)}`).toBe(
        `${page.slug} -> ${related}: true`,
      );
    }
  }
});

test("every in-site docs link in a page body resolves to a real page", async () => {
  const { DOC_PAGES } = await import("../web/src/lib/docs.ts");
  const slugs = new Set(DOC_PAGES.map((page) => page.slug));
  for (const page of DOC_PAGES) {
    for (const match of page.body.matchAll(/\]\(\/docs\/([a-z-]+)\)/g)) {
      const target = match[1] as string;
      if (target === "cli") continue;
      expect(`${page.slug} -> /docs/${target}: ${slugs.has(target)}`).toBe(
        `${page.slug} -> /docs/${target}: true`,
      );
    }
  }
});

test("a reader can reach every verb from the docs, not only from --help", async () => {
  const { DOC_PAGES } = await import("../web/src/lib/docs.ts");
  const notes = await import("../web/src/lib/command-notes.ts");
  const prose = DOC_PAGES.map((page) => page.body).join("\n");
  for (const command of COMMAND_REGISTRY.filter((entry) => !entry.hidden)) {
    const documented =
      prose.includes(`warden ${command.name}`) || Boolean(notes.COMMAND_NOTES[command.name]);
    expect(`${command.name}: ${documented}`).toBe(`${command.name}: true`);
  }
});

test("no doc page is an orphan that nothing else links to", async () => {
  const { DOC_PAGES } = await import("../web/src/lib/docs.ts");
  for (const page of DOC_PAGES) {
    const linked = DOC_PAGES.some((other) => (other.related ?? []).includes(page.slug));
    expect(`${page.slug} is linked from somewhere: ${linked}`).toBe(
      `${page.slug} is linked from somewhere: true`,
    );
  }
});

test("llms.txt groups the docs by section and states the reading paths", async () => {
  const route = readFileSync(
    fileURLToPath(new URL("../web/src/app/llms.txt/route.ts", import.meta.url)),
    "utf8",
  );
  expect(route).toContain("DOC_SECTIONS");
  expect(route).toContain("Reading paths");
  expect(route).toContain("/benchmark");
});

test("the install page moved into the docs and the old url still redirects", async () => {
  const config = readFileSync(
    fileURLToPath(new URL("../web/next.config.ts", import.meta.url)),
    "utf8",
  );
  expect(config).toContain('source: "/install"');
  expect(config).toContain('destination: "/docs/install"');
  const { DOC_PAGES } = await import("../web/src/lib/docs.ts");
  expect(DOC_PAGES.some((page) => page.slug === "install")).toBe(true);
});

test("the sitemap lists every standalone page, not only the docs", async () => {
  const sitemap = readFileSync(
    fileURLToPath(new URL("../web/src/app/sitemap.ts", import.meta.url)),
    "utf8",
  );
  for (const path of ["/", "/docs", "/docs/cli", "/benchmark", "/hack", "/changelog"]) {
    expect(sitemap).toContain(`"${path}"`);
  }
});

const webInstalled = existsSync(
  fileURLToPath(new URL("../web/node_modules/@shikijs/rehype", import.meta.url)),
);
const withWeb = webInstalled ? test : test.skip;

const MARKDOWN_MODULE = new URL("../web/src/lib/markdown.ts", import.meta.url).href;

interface RenderedNode {
  type?: unknown;
  props?: Record<string, unknown>;
}

function serialize(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(serialize).join("");

  const element = node as RenderedNode;
  if (!element.props) return "";
  if (typeof element.type === "function") {
    return serialize((element.type as (props: unknown) => unknown)(element.props));
  }
  const tag = typeof element.type === "string" ? element.type : "component";
  const attributes = Object.entries(element.props)
    .filter(([key]) => key !== "children")
    .map(([key, value]) => ` ${key === "className" ? "class" : key}="${String(value)}"`)
    .join("");
  return `<${tag}${attributes}>${serialize(element.props.children)}</${tag}>`;
}

async function loadRenderMarkdown(): Promise<(body: string) => Promise<string>> {
  const loaded = (await import(MARKDOWN_MODULE)) as {
    renderMarkdown: (body: string) => Promise<unknown>;
  };
  return async (body: string) => serialize(await loaded.renderMarkdown(body));
}

withWeb(
  "code blocks are wrapped and given a copy button on the server, not on hydration",
  async () => {
    const renderMarkdown = await loadRenderMarkdown();
    const html = await renderMarkdown("```sh\nwarden plan\n```\n");
    expect(html).toContain('<div class="code-wrap">');
    expect(html).toContain("copy-button");
    expect(html).toContain('data-copy="idle"');
    expect(html).not.toContain('code-wrap"><div class="code-wrap');
  },
);

withWeb("terminal output is syntax highlighted whether the fence says term or text", async () => {
  const renderMarkdown = await loadRenderMarkdown();
  for (const lang of ["term", "text", "console", "shell-session"]) {
    const html = await renderMarkdown(
      `\`\`\`${lang}\n$ warden benchmark\n  detection 100.0%\n\`\`\`\n`,
    );
    expect(`${lang}: ${html.includes("terminal-block")}`).toBe(`${lang}: true`);
    expect(`${lang}: ${html.includes("t-prompt")}`).toBe(`${lang}: true`);
  }
});

withWeb("internal doc links render through next/link, external links stay anchors", async () => {
  const renderMarkdown = await loadRenderMarkdown();
  const html = await renderMarkdown(
    "See [concepts](/docs/concepts), [the repo](https://github.com/pulkitxm/warden), and [this heading](#gate).\n",
  );
  expect(html).toContain('<component href="/docs/concepts"');
  expect(html).not.toContain('<a href="/docs/concepts"');
  expect(html).toContain('<a href="https://github.com/pulkitxm/warden"');
  expect(html).toContain('<a href="#gate"');
});

withWeb("a language fence shiki knows is still highlighted by shiki", async () => {
  const renderMarkdown = await loadRenderMarkdown();
  const html = await renderMarkdown('```json\n{ "a": 1 }\n```\n');
  expect(html).toContain("shiki");
  expect(html).toContain('<div class="code-wrap">');
});

withWeb("every fence language used in the docs renders as highlighted output", async () => {
  const renderMarkdown = await loadRenderMarkdown();
  const { DOC_PAGES } = await import("../web/src/lib/docs.ts");
  const langs = new Set<string>();
  for (const page of DOC_PAGES) {
    let open = false;
    for (const line of page.body.split("\n")) {
      if (!line.startsWith("```")) continue;
      if (!open) {
        langs.add(line.slice(3).trim() || "(none)");
        open = true;
      } else open = false;
    }
  }
  expect(langs.has("(none)")).toBe(false);
  for (const lang of langs) {
    const html = await renderMarkdown(`\`\`\`${lang}\n$ warden check left-pad\n\`\`\`\n`);
    const highlighted = html.includes("shiki") || html.includes("terminal-block");
    expect(`${lang}: ${highlighted}`).toBe(`${lang}: true`);
  }
});

test("every source path the docs cite actually exists", async () => {
  const { DOC_PAGES } = await import("../web/src/lib/docs.ts");
  for (const page of DOC_PAGES) {
    for (const match of page.body.matchAll(
      /`((?:src|test|scripts|fixtures)\/[A-Za-z0-9_./-]+\.(?:ts|sh|json|mjs))`/g,
    )) {
      const path = fileURLToPath(new URL(`../${match[1]}`, import.meta.url));
      expect(`${page.slug} cites ${match[1]}: ${existsSync(path)}`).toBe(
        `${page.slug} cites ${match[1]}: true`,
      );
    }
  }
});

const NOT_IN_SOURCE = new Set(["l0dash", "peerDependencies"]);

test("every code identifier the docs name still exists in the source", async () => {
  const { DOC_PAGES } = await import("../web/src/lib/docs.ts");
  const files = new Bun.Glob("src/**/*.ts").scanSync({
    cwd: fileURLToPath(new URL("..", import.meta.url)),
  });
  let source = "";
  for (const file of files) {
    source += readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");
  }

  for (const page of DOC_PAGES) {
    const cited = new Set<string>();
    for (const match of page.body.matchAll(/`([a-z][a-zA-Z0-9]{4,})`/g))
      cited.add(match[1] as string);
    for (const match of page.body.matchAll(/`([A-Z][A-Z0-9_]{4,})`/g))
      cited.add(match[1] as string);
    for (const identifier of cited) {
      if (NOT_IN_SOURCE.has(identifier)) continue;
      expect(`${page.slug} names ${identifier}: ${source.includes(identifier)}`).toBe(
        `${page.slug} names ${identifier}: true`,
      );
    }
  }
});

const PLAN_SECTIONS = [
  "Direct changes",
  "Graph changes",
  "Execution surface",
  "Analysis coverage",
  "Decision:",
  "Next action",
];

test("every published plan sample is a whole plan, not an edited excerpt", () => {
  const sources = [
    ["web/src/lib/docs.ts", siteDocs],
    ["web/src/app/page.tsx", read("../web/src/app/page.tsx")],
    ["web/src/app/hack/page.tsx", read("../web/src/app/hack/page.tsx")],
  ] as const;
  const abridged: string[] = [];
  for (const [name, text] of sources) {
    for (const match of text.matchAll(/Warden plan: [^\n\\`]*/g)) {
      const from = match.index ?? 0;
      const window = text.slice(from, from + 1600);
      const end = /written to \.warden\/plans\/\S+/.exec(window);
      const block = end ? window.slice(0, end.index + end[0].length) : window;
      const missing = PLAN_SECTIONS.filter((section) => !block.includes(section));
      if (!end) missing.push("the written-to footer");
      if (missing.length) abridged.push(`${name}: ${match[0].trim()} omits ${missing.join(", ")}`);
    }
  }
  expect(abridged).toEqual([]);
});
