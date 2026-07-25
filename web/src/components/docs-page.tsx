import Link from "next/link";
import type { ReactNode } from "react";
import { Breadcrumbs } from "@/components/chrome";
import { PageActions } from "@/components/page-actions";
import { Toc, type TocItem } from "@/components/toc";

export type { TocItem };

export interface PageLink {
  href: string;
  label: string;
}

export function DocsPage({
  trail,
  eyebrow,
  title,
  description,
  toc,
  children,
  previous,
  next,
  related,
  markdownPath,
}: {
  trail: Array<{ name: string; path: string }>;
  eyebrow: string;
  title: string;
  description: string;
  toc: TocItem[];
  children: ReactNode;
  previous?: PageLink;
  next?: PageLink;
  related?: Array<{ href: string; label: string; description?: string }>;
  markdownPath?: string;
}) {
  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_216px] xl:gap-10">
      <article className="min-w-0 max-w-3xl">
        <Breadcrumbs trail={trail} />
        <p className="text-[13px] font-semibold tracking-[0.16em] text-mint uppercase">{eyebrow}</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{title}</h1>
          {markdownPath ? <PageActions markdownPath={markdownPath} title={title} /> : null}
        </div>
        <p className="mt-4 text-lg leading-relaxed text-fog">{description}</p>
        <hr className="my-8 border-white/10" />

        {children}

        {related?.length ? (
          <section className="mt-14">
            <h2 className="text-[13px] font-semibold tracking-[0.16em] text-mint uppercase">
              Related
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {related.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-xl border border-white/12 bg-navy-soft/40 px-4 py-3 transition hover:border-mint/40"
                >
                  <span className="font-medium text-white">{item.label}</span>
                  {item.description ? (
                    <p className="mt-1 text-[13px] leading-relaxed text-fog">{item.description}</p>
                  ) : null}
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {previous || next ? (
          <nav className="mt-12 flex items-center justify-between gap-3 border-t border-white/10 pt-6">
            {previous ? (
              <Link
                href={previous.href}
                className="rounded-lg border border-white/12 bg-navy-soft/50 px-3.5 py-2 text-[13.5px] text-fog transition hover:border-mint/40 hover:text-white"
              >
                ← {previous.label}
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link
                href={next.href}
                className="rounded-lg border border-white/12 bg-navy-soft/50 px-3.5 py-2 text-[13.5px] text-fog transition hover:border-mint/40 hover:text-white"
              >
                {next.label} →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </article>

      <aside className="hidden xl:block">
        <div className="sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto py-1">
          <Toc items={toc} />

          <div className="mt-7 rounded-xl border border-white/12 bg-navy-soft/50 p-4">
            <h2 className="text-[13.5px] font-semibold text-white">Run it offline</h2>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-fog">
              The whole suite runs against a fixture registry with no network.
            </p>
            <code className="mt-2.5 block rounded-md bg-black/40 px-2 py-1.5 font-mono text-[11.5px] text-mint">
              make doctor-demo
            </code>
          </div>
        </div>
      </aside>
    </div>
  );
}
