export const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://warden.pulkit.page"
).replace(/\/$/, "");

export const site = {
  name: "Warden",
  tagline: "Safe dependency changes for humans and coding agents",
  description:
    "Warden previews the complete package graph, blocks unapproved install scripts and suspicious releases, verifies the project, and gives Claude Code or Codex an actionable path forward.",
  repo: "https://github.com/pulkitxm/warden",
  url: siteUrl,
} as const;

export function absolute(path: string): string {
  return `${siteUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export const nav = [
  { href: "/docs", label: "Docs" },
  { href: "/docs/transactions", label: "Transactions" },
  { href: "/docs/cli", label: "CLI" },
  { href: "/docs/agents", label: "Agents" },
  { href: "/docs/limitations", label: "Limitations" },
  { href: "/install", label: "Install" },
] as const;

export const footerLinks = [
  {
    heading: "Start",
    links: [
      { href: "/install", label: "Install" },
      { href: "/docs/getting-started", label: "Getting started" },
      { href: "/docs/concepts", label: "Concepts" },
      { href: "/docs/troubleshooting", label: "Troubleshooting" },
    ],
  },
  {
    heading: "Reference",
    links: [
      { href: "/docs/cli", label: "CLI reference" },
      { href: "/docs/configuration", label: "Configuration" },
      { href: "/docs/schemas", label: "JSON schemas" },
      { href: "/docs/coverage", label: "Command coverage" },
      { href: "/docs/limitations", label: "Limitations" },
      { href: "/changelog", label: "Changelog" },
    ],
  },
  {
    heading: "Guides",
    links: [
      { href: "/docs/transactions", label: "Transactions" },
      { href: "/docs/policy", label: "Policy" },
      { href: "/docs/doctor", label: "Doctor" },
      { href: "/docs/intent", label: "Intent" },
      { href: "/docs/ci", label: "CI" },
      { href: "/docs/agents", label: "Agents" },
    ],
  },
  {
    heading: "Project",
    links: [
      { href: "/hack", label: "Hackathon" },
      { href: "/about", label: "About" },
      { href: "/contact", label: "Contact" },
      { href: "/docs/security", label: "Threat model" },
      { href: site.repo, label: "GitHub" },
    ],
  },
] as const;
