const packageResults = {
  "left-pad": {
    package: "left-pad@1.3.0",
    verdict: "ALLOW",
    risk: 10,
    source: "heuristics",
    category: "metadata_anomaly",
    evidence: "No supply-chain risk signals of concern. Package is deprecated, but no dangerous capability was found.",
    exit: 0,
  },
  lodahs: {
    package: "lodahs@0.0.1-security",
    verdict: "BLOCK",
    risk: 60,
    source: "heuristics",
    category: "typosquat",
    evidence: "Name is 1 edit from popular package “lodash”.",
    exit: 20,
  },
  "chalk@5.6.1": {
    package: "chalk@5.6.1",
    verdict: "BLOCK",
    risk: 100,
    source: "blocklist",
    category: "known_malware",
    evidence: "Known-malware blocklist entry MAL-CHALK-2025.",
    exit: 20,
  },
  "react-codeshift": {
    package: "react-codeshift@unknown",
    verdict: "BLOCK",
    risk: 90,
    source: "blocklist",
    category: "slopsquat",
    evidence: "Known invented package name. Do not install or execute it.",
    exit: 20,
  },
};

const defaultResult = (name) => ({
  package: `${name || "package"}@latest`,
  verdict: "WARN",
  risk: 35,
  source: "demo",
  category: "registry_lookup_required",
  evidence: "This static demo does not contact the npm registry. Run Warden locally for a real package verdict.",
  exit: 10,
});

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const header = document.querySelector("[data-header]");
const menuButton = document.querySelector("[data-menu-button]");
const navigation = document.querySelector("[data-nav]");

const closeMenu = () => {
  menuButton?.setAttribute("aria-expanded", "false");
  navigation?.classList.remove("is-open");
  document.body.classList.remove("menu-open");
};

menuButton?.addEventListener("click", () => {
  const open = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!open));
  navigation?.classList.toggle("is-open", !open);
  document.body.classList.toggle("menu-open", !open);
});

navigation?.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));

window.addEventListener(
  "scroll",
  () => header?.classList.toggle("is-scrolled", window.scrollY > 24),
  { passive: true },
);

const revealItems = document.querySelectorAll(".reveal");

if (reduceMotion || !("IntersectionObserver" in window)) {
  revealItems.forEach((item) => item.classList.add("is-visible"));
} else {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.12 },
  );
  revealItems.forEach((item) => revealObserver.observe(item));
}

const heroExamples = [
  { package: "lodahs", version: "@0.0.1", verdict: "BLOCK", score: "risk 60 / 100", command: "npm install lodahs", state: "block" },
  { package: "left-pad", version: "@1.3.0", verdict: "ALLOW", score: "risk 10 / 100", command: "pnpm add left-pad", state: "allow" },
  { package: "chalk", version: "@5.6.1", verdict: "BLOCK", score: "risk 100 / 100", command: "bun add chalk@5.6.1", state: "block" },
];

const heroPackage = document.querySelector("[data-hero-package]");
const heroVersion = document.querySelector("[data-hero-version]");
const heroVerdict = document.querySelector("[data-hero-verdict]");
const heroScore = document.querySelector("[data-hero-score]");
const heroCommand = document.querySelector("[data-hero-command]");
const heroStamp = document.querySelector("[data-hero-stamp]");
let heroIndex = 0;

const updateHero = () => {
  heroIndex = (heroIndex + 1) % heroExamples.length;
  const example = heroExamples[heroIndex];
  if (heroPackage) heroPackage.textContent = example.package;
  if (heroVersion) heroVersion.textContent = example.version;
  if (heroVerdict) heroVerdict.textContent = example.verdict;
  if (heroScore) heroScore.textContent = example.score;
  if (heroCommand) heroCommand.textContent = example.command;
  if (heroStamp) heroStamp.className = `verdict-stamp is-${example.state}`;
};

if (!reduceMotion) window.setInterval(updateHero, 4200);

const pipeline = document.querySelector("[data-pipeline]");
const pipelineSteps = [...document.querySelectorAll("[data-pipeline-step]")];
const pipelineRail = pipeline?.querySelector(".pipeline-rail i");
const pipelinePackage = pipeline?.querySelector(".pipeline-package");
let pipelineIndex = 0;

const movePipeline = () => {
  pipelineIndex = (pipelineIndex + 1) % pipelineSteps.length;
  pipelineSteps.forEach((step, index) => step.classList.toggle("is-active", index === pipelineIndex));
  const progress = ((pipelineIndex + 1) / pipelineSteps.length) * 100;
  if (pipelineRail) {
    pipelineRail.style.width = window.innerWidth > 1040 ? `${progress}%` : "1px";
    pipelineRail.style.height = window.innerWidth > 1040 ? "1px" : `${progress}%`;
  }
  if (pipelinePackage) {
    pipelinePackage.style.left = window.innerWidth > 1040 ? `calc(${pipelineIndex * 25}% - 4px)` : "0";
    pipelinePackage.style.top = window.innerWidth > 1040 ? "-1px" : `calc(${pipelineIndex * 20}% - 1px)`;
  }
};

if (!reduceMotion) window.setInterval(movePipeline, 1600);

const scanner = document.querySelector("[data-scanner]");
const scannerForm = document.querySelector("[data-scanner-form]");
const packageInput = document.querySelector("#package-input");
const progressItems = [...document.querySelectorAll("[data-scan-progress] > div")];
const scanResult = document.querySelector("[data-scan-result]");
let scanRun = 0;

const renderResult = (result) => {
  const state = result.verdict.toLowerCase();
  scanResult.className = `scan-result is-${state}`;
  document.querySelector("[data-result-verdict]").textContent = result.verdict;
  document.querySelector("[data-result-risk]").textContent = String(result.risk);
  document.querySelector("[data-result-package]").textContent = result.package;
  document.querySelector("[data-result-source]").textContent = result.source;
  document.querySelector("[data-result-evidence]").textContent = result.evidence;
  document.querySelector("[data-result-category]").textContent = result.category;
  document.querySelector("[data-result-exit]").textContent = `exit ${result.exit}`;
  const ring = document.querySelector("[data-risk-ring]");
  ring?.style.setProperty("--risk", String(result.risk));
};

const runScan = async (value) => {
  const normalized = value.trim().toLowerCase();
  const currentRun = ++scanRun;
  const result = packageResults[normalized] ?? defaultResult(value.trim());
  scanResult?.classList.add("is-loading");
  progressItems.forEach((item) => item.classList.remove("is-done"));
  const delay = reduceMotion ? 0 : 180;
  for (const item of progressItems) {
    await new Promise((resolve) => window.setTimeout(resolve, delay));
    if (currentRun !== scanRun) return;
    item.classList.add("is-done");
  }
  if (currentRun !== scanRun) return;
  renderResult(result);
};

scannerForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  runScan(packageInput?.value ?? "");
});

scanner?.querySelectorAll("[data-package]").forEach((button) => {
  button.addEventListener("click", () => {
    const value = button.getAttribute("data-package") ?? "";
    if (packageInput) packageInput.value = value;
    runScan(value);
  });
});

document.querySelector("[data-focus-scanner]")?.addEventListener("click", () => {
  scanner?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  window.setTimeout(() => packageInput?.focus(), reduceMotion ? 0 : 700);
});

const tabs = [...document.querySelectorAll("[data-tab]")];
const panels = [...document.querySelectorAll("[data-panel]")];
const terminalTitle = document.querySelector("[data-terminal-title]");
const tabTitles = { local: "local check", intercept: "transparent interception", ci: "pull request gate" };

const activateTab = (name) => {
  tabs.forEach((tab) => {
    const active = tab.getAttribute("data-tab") === name;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  panels.forEach((panel) => {
    const active = panel.getAttribute("data-panel") === name;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
  if (terminalTitle) terminalTitle.textContent = tabTitles[name];
};

tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => activateTab(tab.getAttribute("data-tab")));
  tab.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(index + direction + tabs.length) % tabs.length];
    activateTab(next.getAttribute("data-tab"));
    next.focus();
  });
});

const copyText = async (text, statusNode, fallback = "Copied") => {
  let copied = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      copied = true;
    } else {
      const field = document.createElement("textarea");
      field.value = text;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.append(field);
      field.select();
      copied = document.execCommand("copy");
      field.remove();
    }
  } catch {
    copied = false;
  }
  if (statusNode) statusNode.textContent = copied ? fallback : "Select and copy the command";
  window.setTimeout(() => {
    if (statusNode) statusNode.textContent = "";
  }, 1800);
};

const installCommand = document.querySelector("[data-install-command]");
const installButton = document.querySelector("[data-copy-install]");
const installStatus = document.querySelector("[data-install-status]");

installButton?.addEventListener("click", () => {
  copyText(installCommand?.textContent ?? "", installButton, "Copied");
  window.setTimeout(() => {
    if (installButton) installButton.textContent = "Copy";
  }, 1800);
});

const verdictJson = JSON.stringify(
  {
    schema_version: 1,
    package: "chalk",
    version: "5.6.1",
    verdict: "block",
    risk_score: 100,
    categories: ["known_malware"],
    source: "blocklist",
  },
  null,
  2,
);

document.querySelector("[data-copy-json]")?.addEventListener("click", () => {
  copyText(verdictJson, document.querySelector("[data-json-status]"), "JSON copied");
});

document.querySelectorAll(".faq-list details").forEach((detail) => {
  detail.addEventListener("toggle", () => {
    if (!detail.open) return;
    document.querySelectorAll(".faq-list details").forEach((other) => {
      if (other !== detail) other.open = false;
    });
  });
});

if (installStatus) installStatus.setAttribute("data-ready", "true");
