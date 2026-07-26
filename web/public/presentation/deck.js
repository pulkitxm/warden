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
    { text: "BLOCK  diff does not match the prompt · exit 20", kind: "info", pause: 0 },
  ],
};

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPIN_MS = 80;

let playback = 0;
const staticExport = window.location.search.includes("static");

if (staticExport) document.documentElement.classList.add("static-export");

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
  if (window.location.search.includes("print-pdf") || staticExport) renderStaticTerminals();
  else playTerminal(event.currentSlide);
});

Reveal.on("slidechanged", (event) => {
  if (staticExport) renderFinalTerminal(event.currentSlide);
  else playTerminal(event.currentSlide);
});
window.addEventListener("beforeprint", renderStaticTerminals);

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
