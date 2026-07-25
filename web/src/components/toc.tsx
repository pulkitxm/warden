"use client";

import { useEffect, useState } from "react";

export interface TocItem {
  id: string;
  text: string;
}

export function Toc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    if (!items.length) return;

    const headings = items
      .map((item) => document.getElementById(item.id))
      .filter((element): element is HTMLElement => element !== null);
    if (!headings.length) return;

    const pick = () => {
      const top = window.scrollY + 120;
      let current = headings[0] as HTMLElement;
      for (const heading of headings) {
        if (heading.offsetTop <= top) current = heading;
        else break;
      }
      const atBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 2;
      setActive(atBottom ? ((headings[headings.length - 1] as HTMLElement).id ?? "") : current.id);
    };

    pick();
    window.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("resize", pick);
    return () => {
      window.removeEventListener("scroll", pick);
      window.removeEventListener("resize", pick);
    };
  }, [items]);

  if (!items.length) return null;

  return (
    <>
      <h2 className="text-[12px] font-medium tracking-wide text-fog/70">On this page</h2>
      <ul className="mt-2.5 space-y-1.5">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              aria-current={active === item.id ? "location" : undefined}
              className={`block text-[13px] leading-snug transition ${
                active === item.id ? "font-medium text-white" : "text-fog hover:text-mint"
              }`}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
