export const siteUrl = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://warden.pulkit.page"
).replace(/\/$/, "");

export const site = {
  name: "Warden",
  tagline: "The trust layer for npm and coding agents",
  description:
    "Warden vets packages before they install, audits your lockfile, install scripts and registry config, repairs vulnerable dependencies through a supply-chain gate, and checks that an agent's diff matches the prompt it was given.",
  repo: "https://github.com/pulkitxm/warden",
  url: siteUrl,
} as const;

export function absolute(path: string): string {
  return `${siteUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

export const nav = [
  { href: "/docs", label: "Docs" },
  { href: "/docs/cli", label: "CLI" },
  { href: "/docs/agents", label: "Agents" },
  { href: "/docs/security", label: "Security" },
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
      { href: "/changelog", label: "Changelog" },
    ],
  },
  {
    heading: "Guides",
    links: [
      { href: "/docs/doctor", label: "Doctor" },
      { href: "/docs/intent", label: "Intent" },
      { href: "/docs/ci", label: "CI" },
      { href: "/docs/agents", label: "Agents" },
    ],
  },
  {
    heading: "Project",
    links: [
      { href: "/about", label: "About" },
      { href: "/contact", label: "Contact" },
      { href: "/docs/security", label: "Threat model" },
      { href: site.repo, label: "GitHub" },
    ],
  },
] as const;
