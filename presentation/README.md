# Warden presentation

This is a Reveal.js deck with automatic CSS motion, terminal playback, sourced figures, and an audited PDF export.

## Present locally

```sh
cd presentation
python3 -m http.server 4173
```

Open `http://localhost:4173`. Use one arrow-key or space-bar press per slide. Each slide runs its internal animation automatically. Press `F` for full screen and `S` for speaker view.

## Ready-to-share outputs

- `warden-deck.pdf`: 13-page, 16:9 presentation export
- `warden-preview.mp4`: complete animation playback for review

## Structure

- `index.html`: slide content and citations
- `styles.css`: layout, charts, animation, and print styling
- `deck.js`: Reveal.js setup and terminal playback

The deck uses Reveal.js 5.2.1 from jsDelivr, bundled Bricolage Grotesque, and the native macOS terminal font stack.
