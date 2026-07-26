import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const DECK = fileURLToPath(new URL("../web/public/presentation", import.meta.url));
const OUT = join(DECK, "warden-deck.pdf");
const REVEAL = "https://cdn.jsdelivr.net/npm/reveal.js@5.2.1/dist";
const SLIDES = 18;
const PORT = Number(process.env.DECK_PORT ?? 8123);

const TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".md": "text/plain",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
};

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  return root ? join(root, "chromium") : undefined;
}

async function cacheReveal() {
  const files = new Map();
  for (const name of ["reveal.css", "reveal.js"]) {
    const response = await fetch(`${REVEAL}/${name}`);
    if (!response.ok) throw new Error(`${name}: ${response.status} from jsDelivr`);
    files.set(name, await response.text());
  }
  return files;
}

function serve() {
  const server = createServer(async (request, response) => {
    const path = join(DECK, decodeURIComponent((request.url ?? "/").split("?")[0]));
    try {
      const body = await readFile(path);
      response.writeHead(200, {
        "content-type": TYPES[extname(path)] ?? "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("not found");
    }
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

const reveal = await cacheReveal();
const server = await serve();
const browser = await chromium.launch({
  executablePath: chromiumPath(),
  args: ["--no-sandbox"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.route(`${REVEAL}/*`, (route) => {
    const name = route.request().url().endsWith(".css") ? "reveal.css" : "reveal.js";
    route.fulfill({
      status: 200,
      contentType: name.endsWith(".css") ? "text/css" : "text/javascript",
      body: reveal.get(name),
    });
  });

  await page.goto(`http://localhost:${PORT}/index.html?print-pdf&static`, {
    waitUntil: "networkidle",
    timeout: 120000,
  });
  await page.waitForFunction(() => document.documentElement.classList.contains("print-pdf"), {
    timeout: 30000,
  });
  await page.waitForFunction(
    (expected) => document.querySelectorAll(".pdf-page").length === expected,
    SLIDES,
    { timeout: 30000 },
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(4000);

  const box = await page.evaluate(() => {
    const first = document.querySelector(".pdf-page");
    return { width: first.offsetWidth, height: first.offsetHeight };
  });
  await page.pdf({
    path: OUT,
    width: `${box.width}px`,
    height: `${box.height}px`,
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    pageRanges: `1-${SLIDES}`,
  });

  const pdf = await readFile(OUT);
  const pages = pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;
  if (pages !== SLIDES) throw new Error(`exported ${pages} pages, expected ${SLIDES}`);
  process.stdout.write(`warden-deck.pdf: ${pages} pages, ${Math.round(pdf.length / 1024)}KB\n`);
} finally {
  await browser.close();
  server.close();
}
