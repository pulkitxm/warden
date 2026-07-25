import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { footerLinks, nav, site } from "@/lib/site";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-navy/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-5 py-3.5 sm:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <Logo className="h-6 w-6 text-white" />
          <span className="text-[15px] font-bold tracking-tight text-white">Warden</span>
        </Link>
        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 rounded-lg px-2.5 py-1.5 text-[13.5px] text-fog transition hover:bg-white/5 hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <a
          href={site.repo}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-[13.5px] text-white transition hover:border-mint/60 hover:text-mint"
        >
          GitHub
        </a>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mt-24 border-t border-white/10 bg-navy-soft/40">
      <div className="mx-auto max-w-[1400px] px-5 py-14 sm:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-1">
            <div className="flex items-center gap-2.5">
              <Logo className="h-6 w-6 text-white" />
              <span className="font-bold text-white">Warden</span>
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-fog">{site.tagline}.</p>
          </div>
          {footerLinks.map((group) => (
            <div key={group.heading}>
              <h2 className="text-[13px] font-semibold tracking-wide text-white uppercase">
                {group.heading}
              </h2>
              <ul className="mt-3 space-y-2">
                {group.links.map((link) =>
                  link.href.startsWith("http") ? (
                    <li key={link.href}>
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-fog transition hover:text-mint"
                      >
                        {link.label}
                      </a>
                    </li>
                  ) : (
                    <li key={link.href}>
                      <Link href={link.href} className="text-sm text-fog transition hover:text-mint">
                        {link.label}
                      </Link>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-col gap-2 border-t border-white/10 pt-6 text-sm text-fog sm:flex-row sm:items-center sm:justify-between">
          <p>MIT licensed. Local-first, deterministic, no telemetry.</p>
          <Link href="/llms.txt" className="transition hover:text-mint">
            /llms.txt
          </Link>
        </div>
      </div>
    </footer>
  );
}

export function Breadcrumbs({ trail }: { trail: Array<{ name: string; path: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-1.5 text-[13px]">
      {trail.map((item, index) => (
        <span key={item.path} className="flex items-center gap-1.5">
          {index > 0 ? <span className="text-white/25">/</span> : null}
          {index === trail.length - 1 ? (
            <span className="text-fog">{item.name}</span>
          ) : (
            <Link href={item.path} className="text-fog transition hover:text-mint">
              {item.name}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}

export function Prose({ html }: { html: string }) {
  return (
    <div
      className="prose-warden max-w-none"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown authored in this repo
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
