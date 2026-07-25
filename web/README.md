# Warden website

Next.js App Router site for [warden.pulkit.page](https://warden.pulkit.page). It replaces the previous static `index.html` and `landing/` pages.

## Develop

```sh
cd web
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm run start    # serve the production build
```

## Configuration

`NEXT_PUBLIC_SITE_URL` sets the absolute origin used for canonical URLs, Open Graph URLs, the sitemap, and `llms.txt`. It defaults to `https://warden.pulkit.page`.

## Content

- `src/lib/docs.ts` holds every documentation page as markdown, plus its title, description, section, and related links. Adding an entry adds the route, the sidebar link, the sitemap entry, and the Open Graph image.
- `src/lib/commands.json` is **generated**. Run `bun scripts/export-cli-reference.ts` from the repository root after changing the command registry, so the CLI reference cannot drift from the binary.
- `src/lib/site.ts` holds the site name, tagline, navigation, and footer.

Markdown is rendered at build time through remark and rehype, with syntax highlighting by Shiki. No highlighting JavaScript is shipped to the browser.

## Agent surfaces

Every docs page and CLI reference page has a markdown mirror at the same path with a `.md` suffix, for example `/docs/doctor.md` and `/docs/cli/check.md`. Each page also offers copy-page, view-as-markdown, and open-in-Claude / open-in-ChatGPT actions, and `/llms.txt` indexes every page with its markdown URL.

## SEO

Every public route has a unique title, description, canonical URL, Open Graph and Twitter card metadata, a dynamically generated 1200x630 Open Graph image, and JSON-LD appropriate to its type. `sitemap.xml`, `robots.txt`, and `llms.txt` are generated from the same content registry, so no route can be orphaned.

## Deployment

Not automated here. The repository owner deploys manually.
