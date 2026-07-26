"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type CommandRef, DOC_SECTIONS, type DocPage } from "@/lib/docs";

interface Group {
  heading: string;
  links: Array<{ href: string; label: string }>;
}

export function DocsNav({ pages, commands }: { pages: DocPage[]; commands: CommandRef[] }) {
  const pathname = usePathname();

  const groups: Group[] = [
    {
      heading: "Overview",
      links: [{ href: "/docs", label: "All docs" }],
    },
    ...DOC_SECTIONS.map((section) => ({
      heading: section,
      links: pages
        .filter((page) => page.section === section)
        .map((page) => ({ href: `/docs/${page.slug}`, label: page.title })),
    })),
    {
      heading: "CLI",
      links: [
        { href: "/docs/cli", label: "All commands" },
        ...commands.map((command) => ({
          href: `/docs/cli/${command.name}`,
          label: command.name,
        })),
      ],
    },
  ];

  return (
    <nav aria-label="Documentation" className="space-y-7">
      {groups.map((group) => (
        <div key={group.heading}>
          <h2 className="px-3 text-[12px] font-medium tracking-wide text-fog/70">
            {group.heading}
          </h2>
          <ul className="mt-2 space-y-0.5">
            {group.links.map((link) => {
              const active = pathname === link.href;
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={`block truncate rounded-lg px-3 py-1.5 text-[13.5px] transition ${
                      active
                        ? "bg-white/10 font-medium text-white"
                        : "text-fog hover:bg-mint/10 hover:text-mint"
                    }`}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
