const terminalScripts = {
  check: [
    { text: "warden check acme-http@1.0.1", kind: "command", typed: true, pause: 380 },
    { text: "resolving acme-http@1.0.1", kind: "dim", pause: 260 },
    { text: "✓ integrity verified   sha512", kind: "good", pause: 240 },
    { text: "! release diff         postinstall added", kind: "bad", pause: 240 },
    { text: "! provenance           attestation removed", kind: "bad", pause: 240 },
    { text: "! code                 process.env → raw IP", kind: "bad", pause: 350 },
    { text: "BLOCK  acme-http@1.0.1   risk 100 / 100", kind: "bad", pause: 240 },
    { text: "exit 20 · install never started", kind: "info", pause: 0 },
  ],
  doctor: [
    { text: "wnpm doctor", kind: "command", typed: true, pause: 380 },
    { text: "auditing 3 direct dependencies against OSV advisories", kind: "dim", pause: 260 },
    { text: "high      acme-json@2.1.0   prototype pollution  (fixed in 2.1.4)", kind: "bad", pause: 260 },
    { text: "critical  acme-http@1.0.0   request smuggling    (fixed in 1.0.1)", kind: "bad", pause: 300 },
    { text: "BLOCK  acme-http@1.0.1   install-script added, exfiltration, provenance downgrade", kind: "bad", pause: 340 },
    { text: "UNFIXABLE  acme-http: the official fix fails the supply-chain gate", kind: "bad", pause: 300 },
    { text: "verified   acme-json@2.1.4 · install ok · test ok · applied", kind: "good", pause: 260 },
    { text: "1 of 2 issues fixed · exit 10", kind: "info", pause: 0 },
  ],
  intent: [
    { text: "warden intent check", kind: "command", typed: true, pause: 380 },
    { text: 'prompt   "add rate limiting, keep the retry logic, log every rate-limited request"', kind: "dim", pause: 280 },
    { text: "3 claims extracted · 2 files changed", kind: "dim", pause: 240 },
    { text: "✓ delivered   add rate limiting               api-client.ts:1-39", kind: "good", pause: 240 },
    { text: "✓ preserved   retry logic untouched", kind: "good", pause: 240 },
    { text: "✗ dropped     log every rate-limited request  no matching change", kind: "bad", pause: 280 },
    { text: "! scope creep pagination.ts, 55 lines, never requested", kind: "bad", pause: 260 },
    { text: "! hallucinated axios.instance.throttle, not exported by axios", kind: "bad", pause: 320 },
    { text: "BLOCK  3 findings", kind: "bad", pause: 260 },
    { text: "exit 20 · diff does not match the prompt", kind: "info", pause: 0 },
  ],
  agent: [
    { text: "warden fix", kind: "command", typed: true, pause: 340 },
    { text: "wrote .warden/handoff.json", kind: "good", pause: 220 },
    { text: "finding   expres@0.0.5 · typosquat", kind: "bad", pause: 180 },
    { text: "evidence  1 edit from express · postinstall added", kind: "info", pause: 180 },
    { text: "fix       replace expres with express", kind: "good", pause: 180 },
    { text: "verify    warden ci --reporter agent", kind: "good", pause: 240 },
    { text: "launch    codex exec \"Read .warden/handoff.json…\"", kind: "info", pause: 300 },
    { text: "codex exec \"Read .warden/handoff.json and apply the fix\"", kind: "command", typed: true, pause: 260 },
    { text: "updated   package.json · expres → express", kind: "good", pause: 220 },
    { text: "warden ci --reporter agent", kind: "command", typed: true, pause: 260 },
    { text: "verdict   allow · exit 0", kind: "good", pause: 0 },
  ],
}

let playback = 0

const wait = (duration, id) =>
  new Promise((resolve) => {
    window.setTimeout(() => resolve(id === playback), duration)
  })

const appendCursor = (line) => {
  const cursor = document.createElement("span")
  cursor.className = "terminal-cursor"
  line.append(cursor)
  return cursor
}

const playTerminal = async (slide) => {
  const name = slide.dataset.terminal
  const screen = slide.querySelector(".terminal-screen")
  if (!name || !screen || !terminalScripts[name]) return
  const id = ++playback
  screen.replaceChildren()
  if (!(await wait(1050, id))) return
  for (const entry of terminalScripts[name]) {
    if (id !== playback) return
    const line = document.createElement("div")
    line.className = `terminal-line ${entry.kind}`
    screen.append(line)
    const cursor = appendCursor(line)
    if (entry.typed) {
      for (const character of entry.text) {
        if (id !== playback) return
        cursor.before(character)
        const keyDelay = entry.text.length > 70 ? 12 : 24
        if (!(await wait(keyDelay, id))) return
      }
    } else {
      cursor.before(entry.text)
    }
    screen.scrollTo({ top: screen.scrollHeight, behavior: "smooth" })
    cursor.remove()
    if (!(await wait(entry.pause, id))) return
  }
  const finalLine = screen.lastElementChild
  if (finalLine) appendCursor(finalLine)
}

const updateSlide = (slide) => {
  playTerminal(slide)
}

const renderStaticTerminals = () => {
  document.querySelectorAll("[data-terminal]").forEach((slide) => {
    const name = slide.dataset.terminal
    const screen = slide.querySelector(".terminal-screen")
    if (!name || !screen || !terminalScripts[name]) return
    screen.replaceChildren()
    terminalScripts[name].forEach((entry) => {
      const line = document.createElement("div")
      line.className = `terminal-line ${entry.kind}`
      line.textContent = entry.text
      screen.append(line)
    })
    screen.scrollTop = screen.scrollHeight
  })
}

Reveal.on("ready", (event) => {
  if (window.location.search.includes("print-pdf")) renderStaticTerminals()
  else updateSlide(event.currentSlide)
})
Reveal.on("slidechanged", (event) => updateSlide(event.currentSlide))
window.addEventListener("beforeprint", renderStaticTerminals)

const initializeDeck = async () => {
  await document.fonts.ready
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
  })
}

initializeDeck()
