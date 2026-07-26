import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";

function isInternal(href: string): boolean {
  if (href.length === 0) return false;
  if (href.startsWith("//") || href.startsWith("#")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false;
  return href.startsWith("/");
}

export function ProseLink({ href, children, ...rest }: ComponentPropsWithoutRef<"a">) {
  if (typeof href === "string" && isInternal(href) && !href.endsWith(".md")) {
    return (
      <Link href={href} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
