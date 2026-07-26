import Link from "next/link";
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
              className="shrink-0 rounded-lg px-2.5 py-1.5 text-[13.5px] text-fog transition hover:bg-mint/10 hover:text-mint"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <a
          href={site.repo}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-[13.5px] text-white transition hover:border-mint/60 hover:bg-mint/10 hover:text-mint"
        >
          <GitHubMark />
          GitHub
        </a>
      </div>
    </header>
  );
}

function GitHubMark() {
  return (
    <svg
      viewBox="0 0 496 512"
      width="14"
      height="14"
      fill="currentColor"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M165.9 397.4c0 2-2.3 3.6-5.2 3.6-3.3.3-5.6-1.3-5.6-3.6 0-2 2.3-3.6 5.2-3.6 3-.3 5.6 1.3 5.6 3.6zm-31.1-4.5c-.7 2 1.3 4.3 4.3 4.9 2.6 1 5.6 0 6.2-2s-1.3-4.3-4.3-5.2c-2.6-.7-5.5.3-6.2 2.3zm44.2-1.7c-2.9.7-4.9 2.6-4.6 4.9.3 2 2.9 3.3 5.9 2.6 2.9-.7 4.9-2.6 4.6-4.6-.3-1.9-3-3.2-5.9-2.9zM244.8 8C106.1 8 0 113.3 0 252c0 110.9 69.8 205.8 169.5 239.2 12.8 2.3 17.3-5.6 17.3-12.1 0-6.2-.3-40.4-.3-61.4 0 0-70 15-84.7-29.8 0 0-11.4-29.1-27.8-36.6 0 0-22.9-15.7 1.6-15.4 0 0 24.9 2 38.6 25.8 21.9 38.6 58.6 27.5 72.9 20.9 2.3-16 8.8-25.4 16-31-55.9-6.2-112.3-14.3-112.3-110.5 0-27.5 7.6-41.3 23.6-58.9-2.6-6.5-11.1-33.3 2.6-67.9 20.9-6.5 69.4 27.2 69.4 27.2 20-5.6 41.3-8.5 62.4-8.5s42.4 2.9 62.4 8.5c0 0 48.4-33.8 69.4-27.2 13.7 34.7 5.2 61.4 2.6 67.9 16 17.7 25.8 31.5 25.8 58.9 0 96.5-58.9 104.2-114.8 110.5 9.2 7.9 17 22.9 17 46.4 0 33.7-.3 75.4-.3 83.6 0 6.5 4.6 14.4 17.3 12.1C428.2 457.8 496 362.9 496 252 496 113.3 383.5 8 244.8 8zM97.2 352.9c-1.3 1-1 3.3.7 5.2 1.6 1.6 3.9 2.3 5.2 1 1.3-1 1-3.3-.7-5.2-1.6-1.6-3.9-2.3-5.2-1zm-10.8-8.1c-.7 1.3.3 2.9 2.3 3.9 1.6 1 3.6.7 4.3-.7.7-1.3-.3-2.9-2.3-3.9-2-.6-3.6-.3-4.3.7zm32.4 35.6c-1.6 1.3-1 4.3 1.3 6.2 2.3 2.3 5.2 2.6 6.5 1 1.3-1.3.7-4.3-1.3-6.2-2.2-2.3-5.2-2.6-6.5-1zm-11.4-14.7c-1.6 1-1.6 3.6 0 5.9 1.6 2.3 4.3 3.3 5.6 2.3 1.6-1.3 1.6-3.9 0-6.2-1.4-2.3-4-3.3-5.6-2z" />
    </svg>
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
                      <Link
                        href={link.href}
                        className="text-sm text-fog transition hover:text-mint"
                      >
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
