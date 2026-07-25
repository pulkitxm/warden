"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const COPY_LABEL = "Copy";
const DONE_LABEL = "Copied";

function iconFor(state: "idle" | "done"): string {
  return state === "done"
    ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
    : '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
}

export function CopyEnhancer() {
  const pathname = usePathname();

  useEffect(() => {
    const blocks = document.querySelectorAll<HTMLPreElement>("pre.shiki");
    const timers: number[] = [];

    for (const pre of blocks) {
      const parent = pre.parentElement;
      if (!parent || parent.dataset.copyWrap === "true") continue;

      const wrap = document.createElement("div");
      wrap.className = "code-wrap";
      wrap.dataset.copyWrap = "true";
      parent.insertBefore(wrap, pre);
      wrap.appendChild(pre);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "copy-button";
      button.setAttribute("aria-label", `${COPY_LABEL} code`);
      button.innerHTML = `${iconFor("idle")}<span>${COPY_LABEL}</span>`;

      button.addEventListener("click", async () => {
        const text = pre.textContent ?? "";
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const area = document.createElement("textarea");
          area.value = text;
          area.setAttribute("readonly", "");
          area.style.position = "fixed";
          area.style.opacity = "0";
          document.body.appendChild(area);
          area.select();
          try {
            document.execCommand("copy");
          } finally {
            document.body.removeChild(area);
          }
        }
        button.classList.add("is-done");
        button.innerHTML = `${iconFor("done")}<span>${DONE_LABEL}</span>`;
        button.setAttribute("aria-label", `${DONE_LABEL} code`);
        timers.push(
          window.setTimeout(() => {
            button.classList.remove("is-done");
            button.innerHTML = `${iconFor("idle")}<span>${COPY_LABEL}</span>`;
            button.setAttribute("aria-label", `${COPY_LABEL} code`);
          }, 1800),
        );
      });

      wrap.appendChild(button);
    }

    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [pathname]);

  return null;
}
