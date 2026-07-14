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
  shim: [
    { text: "npm install express expres", kind: "command", typed: true, pause: 360 },
    { text: "Warden: vetting 2 packages before install", kind: "info", pause: 280 },
    { text: "ALLOW  express@5.1.0    clean", kind: "good", pause: 260 },
    { text: "BLOCK  expres@0.0.5     typosquat, install-script", kind: "bad", pause: 320 },
    { text: "install aborted · no lifecycle script executed", kind: "bad", pause: 0 },
  ],
  install: [
    { text: "curl -fsSL https://raw.githubusercontent.com/pulkitxm/warden/main/install.sh | sh", kind: "command", typed: true, pause: 360 },
    { text: "warden installer", kind: "info", pause: 210 },
    { text: "system     darwin arm64", kind: "dim", pause: 170 },
    { text: "shell      zsh (~/.zshrc)", kind: "dim", pause: 170 },
    { text: "managers   npm 10.9.2, pnpm 9.4.0, yarn 1.22.22, bun 1.2.8 found", kind: "dim", pause: 210 },
    { text: "existing   none", kind: "dim", pause: 180 },
    { text: "downloading latest release · darwin-arm64 · 100%", kind: "info", pause: 260 },
    { text: "✓ sha256 verified", kind: "good", pause: 230 },
    { text: "Which detected package managers should warden intercept?", kind: "prompt", pause: 140 },
    { text: "> [x] npm", kind: "picker", pause: 100 },
    { text: "  [x] pnpm", kind: "picker", pause: 100 },
    { text: "  [x] yarn", kind: "picker", pause: 100 },
    { text: "  [x] bun", kind: "picker", pause: 100 },
    { text: "  [x] npx", kind: "picker", pause: 100 },
    { text: "  [x] bunx", kind: "picker", pause: 220 },
    { text: "Up/down move, space toggles, enter confirms", kind: "dim", pause: 280 },
    { text: "↵ enter", kind: "input", typed: true, pause: 260 },
    { text: "When warden finds a risky package:", kind: "prompt", pause: 160 },
    { text: "  1) protect  stop the install and show why  (recommended)", kind: "picker", pause: 120 },
    { text: "  2) observe  never stop anything, just keep a record", kind: "picker", pause: 220 },
    { text: "choice [1]: 1", kind: "input", typed: true, pause: 300 },
    { text: "installed  ~/.warden/bin/warden, wnpm, wnpx", kind: "good", pause: 160 },
    { text: "shims     npm pnpm yarn bun npx bunx", kind: "good", pause: 160 },
    { text: "PATH      added shims and binaries to ~/.zshrc", kind: "good", pause: 160 },
    { text: "config    ~/.warden/config.json  (mode: brief, intercept: install+exec)", kind: "good", pause: 220 },
    { text: "IMPORTANT  interception is not active in this shell yet", kind: "bad", pause: 180 },
    { text: "activate   exec zsh", kind: "info", pause: 180 },
    { text: "verify     warden check left-pad", kind: "info", pause: 0 },
  ],
  ci: [
    { text: "warden ci --reporter agent", kind: "command", typed: true, pause: 380 },
    { text: "diff vs merge-base · 1 package changed", kind: "dim", pause: 240 },
    { text: "BLOCK  expres@0.0.5  package.json:14", kind: "bad", pause: 300 },
    { text: "rule      typosquat", kind: "info", pause: 180 },
    { text: "fix       replace expres with express", kind: "good", pause: 180 },
    { text: "verify    warden ci --reporter agent", kind: "good", pause: 220 },
    { text: "verdict block · exit 20", kind: "bad", pause: 0 },
  ],
  intent: [
    { text: "warden intent check", kind: "command", typed: true, pause: 380 },
    { text: 'prompt   "add email validation to the login form"', kind: "dim", pause: 260 },
    { text: "3 claims extracted · 2 hunks changed", kind: "dim", pause: 240 },
    { text: "✓ claim matched     validate email format       login.tsx:42", kind: "good", pause: 240 },
    { text: "✓ claim matched     inline error message         login.tsx:58", kind: "good", pause: 240 },
    { text: "! unclaimed hunk    checkout.ts:120  no matching claim", kind: "bad", pause: 260 },
    { text: '! hallucinated API  stripe.chargeInstantly()  not exported by "stripe"', kind: "bad", pause: 320 },
    { text: "BLOCK  intent mismatch   2 findings", kind: "bad", pause: 260 },
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
