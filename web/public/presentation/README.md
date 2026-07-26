# Warden presentation

This is a 16-slide Reveal.js deck with automatic CSS motion, terminal playback, sourced figures, and a verified PDF export. It is served by the Next.js site as static assets, so `/presentation/index.html` is the deck itself, not a rewrite to anywhere else.

## Present locally

```sh
cd web
npm run dev
```

Open `http://localhost:3000/presentation/index.html`. Use one arrow-key or space-bar press per slide. Each slide runs its internal animation automatically. Press `F` for full screen and `S` for speaker view. Every terminal slide has a SKIP control in its title bar that jumps straight to the final state, and each terminal scrolls if its output is taller than the pane.

## Ready-to-share outputs

- `warden-deck.pdf`: 16:9 presentation export, one page per slide

## Structure

- `index.html`: slide content and citations
- `styles.css`: layout, charts, animation, and print styling
- `deck.js`: Reveal.js setup and terminal playback
- `speaker-script.md`: slide-by-slide presenter script
- `presentation-context.md`: transaction narrative, functionality inventory, demo cues, maturity limits, and sources

The deck uses Reveal.js 5.2.1 from jsDelivr, bundled Bricolage Grotesque, and the native macOS terminal font stack.
