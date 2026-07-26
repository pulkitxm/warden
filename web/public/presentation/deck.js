const terminalScripts = {
  plan: [
    { text: "warden plan -- npm install esbuild", kind: "command", typed: true, pause: 320 },
    {
      kind: "progress",
      label: "resolving the prospective dependency graph",
      count: 27,
      seconds: 6.1,
      real: 3000,
      details: [
        { at: 0, text: "reading esbuild" },
        { at: 0.3, text: "reading @esbuild/darwin-arm64" },
        { at: 0.6, text: "reading @esbuild/linux-x64" },
        { at: 0.85, text: "reading @esbuild/win32-x64" },
      ],
      pause: 220,
    },
    {
      kind: "progress",
      label: "vetting changed packages",
      count: 27,
      total: 27,
      seconds: 19.6,
      real: 3700,
      details: [
        { at: 0, text: "esbuild@0.28.1: downloading tarball" },
        { at: 0.35, text: "@esbuild/darwin-arm64@0.28.1: scanning" },
        { at: 0.68, text: "@esbuild/linux-arm64@0.28.1: registry metadata" },
        { at: 0.9, text: "@esbuild/win32-ia32@0.28.1: scanning" },
      ],
      pause: 260,
    },
    { text: "Warden plan: npm install esbuild", kind: "prompt", pause: 190 },
    { text: "+ 26 transitive packages · 27 of 27 analyzed", kind: "dim", pause: 220 },
    { text: "NEEDS_APPROVAL  esbuild@0.28.1 has a postinstall script", kind: "bad", pause: 250 },
    { text: "approval binds version + integrity + hook + script body", kind: "info", pause: 220 },
    { text: "script policy: suppressed", kind: "good", pause: 0 },
  ],
  doctor: [
    { text: "warden doctor", kind: "command", typed: true, pause: 320 },
    { text: "auditing 3 direct dependencies against OSV advisories", kind: "dim", pause: 240 },
    { text: "critical  acme-http@1.0.0  fixed in 1.0.1", kind: "bad", pause: 250 },
    {
      text: "BLOCK  acme-http@1.0.1  new script + exfiltration + provenance downgrade",
      kind: "bad",
      pause: 310,
    },
    { text: "UNFIXABLE  the official fix fails the supply-chain gate", kind: "bad", pause: 280 },
    { text: "verified  acme-json@2.1.4  install ok · test ok · applied", kind: "good", pause: 250 },
    { text: "1 of 2 issues fixed · exit 10", kind: "info", pause: 0 },
  ],
  intent: [
    { text: "warden intent check", kind: "command", typed: true, pause: 320 },
    {
      text: 'prompt  "add rate limiting, keep retries, log every limited request"',
      kind: "dim",
      pause: 250,
    },
    { text: "3 claims extracted · 2 files changed", kind: "dim", pause: 210 },
    { text: "✓ delivered   add rate limiting", kind: "good", pause: 210 },
    { text: "✓ preserved   retry logic untouched", kind: "good", pause: 210 },
    { text: "✗ dropped     log every limited request", kind: "bad", pause: 240 },
    { text: "! scope creep  pagination.ts was never requested", kind: "bad", pause: 230 },
    { text: "! hallucinated  axios.instance.throttle is not exported", kind: "bad", pause: 260 },
    {
      text: '! unpublished  import "fetch-retry-helper-pro" has never existed on npm',
      kind: "bad",
      pause: 260,
    },
    { text: "the last two need no model · llm calls: 2", kind: "dim", pause: 220 },
    { text: "BLOCK  diff does not match the prompt · exit 20", kind: "info", pause: 0 },
  ],
};

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPIN_MS = 80;

let playback = 0;
let counterPlayback = 0;
let packageDemoRequest = 0;
const staticExport = window.location.search.includes("static");

if (staticExport) document.documentElement.classList.add("static-export");

const counterLabel = (element, value) => {
  const formatted =
    element.dataset.format === "comma" ? new Intl.NumberFormat("en-US").format(value) : `${value}`;
  return `${formatted}${element.dataset.suffix ?? ""}`;
};

const renderFinalCounters = (slide = document) => {
  slide.querySelectorAll("[data-count]").forEach((element) => {
    element.textContent = counterLabel(element, Number(element.dataset.count));
  });
};

const animateCounters = (slide) => {
  if (!slide) return;
  const id = ++counterPlayback;
  const counters = [...slide.querySelectorAll("[data-count]")];
  if (staticExport || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    renderFinalCounters(slide);
    return;
  }
  counters.forEach((element, index) => {
    const target = Number(element.dataset.count);
    element.textContent = counterLabel(element, 0);
    window.setTimeout(
      () => {
        const started = performance.now();
        const duration = target > 10000 ? 1200 : 850;
        const update = (now) => {
          if (id !== counterPlayback) return;
          const ratio = Math.min(1, (now - started) / duration);
          const eased = 1 - (1 - ratio) ** 3;
          element.textContent = counterLabel(element, Math.round(target * eased));
          if (ratio < 1) window.requestAnimationFrame(update);
        };
        window.requestAnimationFrame(update);
      },
      520 + index * 160,
    );
  });
};

const packageDemoFallback = {
  expres: {
    name: "expres",
    version: "0.0.5",
    description: "Add express compatible methods to your response object",
    repository: "github.com/cpsubrian/node-expres",
    downloads: 7348,
    start: "2026-07-18",
    end: "2026-07-24",
    official: false,
  },
  express: {
    name: "express",
    version: "5.2.1",
    description: "Fast, unopinionated, minimalist web framework",
    repository: "github.com/expressjs/express",
    downloads: 122913839,
    start: "2026-07-18",
    end: "2026-07-24",
    official: true,
  },
};

const packageDate = (value) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));

const packagePeriod = (start, end) => {
  const year = new Date(`${end}T00:00:00Z`).getUTCFullYear();
  return `${packageDate(start)} to ${packageDate(end)} ${year}`;
};

const packageRepository = (metadata) => {
  const source =
    typeof metadata.repository === "string" ? metadata.repository : metadata.repository?.url;
  if (!source) return "repository not published";
  return source
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "")
    .replace(/^https?:\/\//, "")
    .replace(/\.git$/, "");
};

const renderPackageDemo = (slide, data, live) => {
  slide.querySelector("[data-package-path]").textContent = data.name;
  slide.querySelector("[data-package-name]").textContent = data.name;
  slide.querySelector("[data-package-version]").textContent = `latest ${data.version}`;
  slide.querySelector("[data-package-delta]").textContent = data.official
    ? "official spelling"
    : 'missing the final "s"';
  slide.querySelector("[data-package-downloads]").textContent = new Intl.NumberFormat(
    "en-US",
  ).format(data.downloads);
  slide.querySelector("[data-package-period]").textContent = packagePeriod(data.start, data.end);
  slide.querySelector("[data-package-description]").textContent = data.description;
  slide.querySelector("[data-package-repository]").textContent = data.repository;
  const link = slide.querySelector("[data-package-link]");
  link.href = `https://www.npmjs.com/package/${data.name}`;
  const verdict = slide.querySelector("[data-package-verdict]");
  verdict.classList.toggle("official", data.official);
  verdict.classList.toggle("different", !data.official);
  verdict.querySelector("strong").textContent = data.official
    ? "Official Express project"
    : "Different package";
  verdict.querySelector("span").textContent = data.official
    ? "Published from the expressjs/express project."
    : "Real package, but not the official Express web framework.";
  const state = slide.querySelector("[data-package-state]");
  state.classList.toggle("live", live);
  state.classList.remove("loading");
  state.lastChild.textContent = live ? " live npm data" : " captured npm data";
};

const loadPackageDemo = async (slide, name) => {
  const request = ++packageDemoRequest;
  const state = slide.querySelector("[data-package-state]");
  state.classList.remove("live");
  state.classList.add("loading");
  state.lastChild.textContent = " loading npm data";
  try {
    const [downloadResponse, metadataResponse] = await Promise.all([
      fetch(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}`),
      fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`),
    ]);
    if (!downloadResponse.ok || !metadataResponse.ok) throw new Error("npm data unavailable");
    const [downloads, metadata] = await Promise.all([
      downloadResponse.json(),
      metadataResponse.json(),
    ]);
    if (request !== packageDemoRequest) return;
    renderPackageDemo(
      slide,
      {
        name,
        version: metadata.version,
        description: metadata.description,
        repository: packageRepository(metadata),
        downloads: downloads.downloads,
        start: downloads.start,
        end: downloads.end,
        official: name === "express",
      },
      true,
    );
  } catch {
    if (request !== packageDemoRequest) return;
    renderPackageDemo(slide, packageDemoFallback[name], false);
  }
};

const initializePackageDemo = () => {
  const slide = document.querySelector("[data-package-demo]");
  if (!slide) return;
  const select = slide.querySelector("#package-demo-select");
  const refresh = slide.querySelector("[data-package-refresh]");
  const show = () => {
    const name = select.value;
    renderPackageDemo(slide, packageDemoFallback[name], false);
    if (!staticExport) loadPackageDemo(slide, name);
  };
  select.addEventListener("change", show);
  select.addEventListener("keydown", (event) => event.stopPropagation());
  refresh.addEventListener("click", show);
  show();
};

const wait = (duration, id) =>
  new Promise((resolve) => {
    window.setTimeout(() => resolve(id === playback), duration);
  });

const appendCursor = (line) => {
  const cursor = document.createElement("span");
  cursor.className = "terminal-cursor";
  line.append(cursor);
  return cursor;
};

const elapsedLabel = (ms) => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`);

const countLabel = (entry, done) => (entry.total ? `${done}/${entry.total}` : `${done}`);

const detailAt = (entry, ratio) => {
  let current = entry.details[0].text;
  for (const detail of entry.details) if (ratio >= detail.at) current = detail.text;
  return current;
};

const doneLine = (entry) =>
  `✓ ${entry.label} · ${countLabel(entry, entry.count)}   ${elapsedLabel(entry.seconds * 1000)}`;

const playProgress = async (screen, entry, id) => {
  const line = document.createElement("div");
  line.className = "terminal-line spin";
  screen.append(line);
  const started = performance.now();
  let frame = 0;
  for (;;) {
    if (id !== playback) return false;
    const ratio = Math.min(1, (performance.now() - started) / entry.real);
    const spinner = SPINNER[frame++ % SPINNER.length];
    const counted = countLabel(entry, Math.round(ratio * entry.count));
    const time = elapsedLabel(ratio * entry.seconds * 1000);
    line.textContent = `${spinner} ${entry.label} · ${counted} · ${detailAt(entry, ratio)}   ${time}`;
    if (ratio >= 1) break;
    if (!(await wait(SPIN_MS, id))) return false;
  }
  line.className = "terminal-line good";
  line.textContent = doneLine(entry);
  return true;
};

const playTerminal = async (slide) => {
  const name = slide.dataset.terminal;
  const screen = slide.querySelector(".terminal-screen");
  if (!name || !screen || !terminalScripts[name]) return;
  const id = ++playback;
  screen.replaceChildren();
  if (!(await wait(850, id))) return;
  for (const entry of terminalScripts[name]) {
    if (id !== playback) return;
    if (entry.kind === "progress") {
      if (!(await playProgress(screen, entry, id))) return;
      screen.scrollTo({ top: screen.scrollHeight, behavior: "smooth" });
      if (!(await wait(entry.pause, id))) return;
      continue;
    }
    const line = document.createElement("div");
    line.className = `terminal-line ${entry.kind}`;
    screen.append(line);
    const cursor = appendCursor(line);
    if (entry.typed) {
      for (const character of entry.text) {
        if (id !== playback) return;
        cursor.before(character);
        if (!(await wait(entry.text.length > 70 ? 12 : 24, id))) return;
      }
    } else {
      cursor.before(entry.text);
    }
    screen.scrollTo({ top: screen.scrollHeight, behavior: "smooth" });
    cursor.remove();
    if (!(await wait(entry.pause, id))) return;
  }
  const finalLine = screen.lastElementChild;
  if (finalLine) appendCursor(finalLine);
};

const renderFinalTerminal = (slide) => {
  const name = slide?.dataset.terminal;
  const screen = slide?.querySelector(".terminal-screen");
  if (!name || !screen || !terminalScripts[name]) return;
  screen.replaceChildren();
  terminalScripts[name].forEach((entry) => {
    const line = document.createElement("div");
    if (entry.kind === "progress") {
      line.className = "terminal-line good";
      line.textContent = doneLine(entry);
    } else {
      line.className = `terminal-line ${entry.kind}`;
      line.textContent = entry.text;
    }
    screen.append(line);
  });
  screen.scrollTo({ top: screen.scrollHeight, behavior: "instant" });
  appendCursor(screen.lastElementChild);
};

const renderStaticTerminals = () => {
  document.querySelectorAll("[data-terminal]").forEach((slide) => {
    const name = slide.dataset.terminal;
    const screen = slide.querySelector(".terminal-screen");
    if (!name || !screen || !terminalScripts[name]) return;
    screen.replaceChildren();
    terminalScripts[name].forEach((entry) => {
      const line = document.createElement("div");
      if (entry.kind === "progress") {
        line.className = "terminal-line good";
        line.textContent = doneLine(entry);
      } else {
        line.className = `terminal-line ${entry.kind}`;
        line.textContent = entry.text;
      }
      screen.append(line);
    });
    screen.scrollTop = screen.scrollHeight;
  });
};

document.addEventListener("click", (event) => {
  const button = event.target.closest(".terminal-skip");
  if (!button) return;
  playback++;
  renderFinalTerminal(button.closest("[data-terminal]"));
});

Reveal.on("ready", (event) => {
  if (window.location.search.includes("print-pdf") || staticExport) {
    renderStaticTerminals();
    renderFinalCounters();
  } else {
    playTerminal(event.currentSlide);
    animateCounters(event.currentSlide);
  }
});

Reveal.on("slidechanged", (event) => {
  if (staticExport) {
    renderFinalTerminal(event.currentSlide);
    renderFinalCounters(event.currentSlide);
  } else {
    playTerminal(event.currentSlide);
    animateCounters(event.currentSlide);
  }
});
window.addEventListener("beforeprint", renderStaticTerminals);
window.addEventListener("beforeprint", () => renderFinalCounters());

initializePackageDemo();

const initializeDeck = async () => {
  await document.fonts.ready;
  await Reveal.initialize({
    hash: true,
    history: true,
    controls: false,
    progress: false,
    center: false,
    transition: "none",
    backgroundTransition: "none",
    slideNumber: false,
    width: 1280,
    height: 720,
    margin: 0,
    minScale: 0.2,
    maxScale: 1.8,
  });
};

initializeDeck();
