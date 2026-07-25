import type { ReactNode } from "react";
import { DocsNav } from "@/components/docs-nav";
import { COMMANDS, DOC_PAGES } from "@/lib/docs";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-[1600px] px-5 sm:px-8">
      <div className="lg:grid lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-10">
        <aside className="hidden lg:block">
          <div className="sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto py-10 pr-2">
            <DocsNav pages={DOC_PAGES} commands={COMMANDS} />
          </div>
        </aside>
        <div className="min-w-0 py-10">{children}</div>
      </div>
    </div>
  );
}
