"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const COPY_LABEL = "Copy";
const DONE_LABEL = "Copied";

const CHECK_ICON = '<path d="M20 6 9 17l-5-5"/>';
const COPY_ICON =
  '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>';

function setState(button: HTMLButtonElement, done: boolean): void {
  const svg = button.querySelector("svg");
  if (svg) {
    svg.innerHTML = done ? CHECK_ICON : COPY_ICON;
    svg.setAttribute("stroke-width", done ? "2.4" : "2");
  }
  const label = done ? DONE_LABEL : COPY_LABEL;
  const span = button.querySelector("span");
  if (span) span.textContent = label;
  button.setAttribute("aria-label", `${label} code`);
  button.classList.toggle("is-done", done);
}

async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
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
}

export function CopyEnhancer() {
  const pathname = usePathname();

  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname rebinds buttons after client-side navigation
  useEffect(() => {
    const buttons = document.querySelectorAll<HTMLButtonElement>(
      ".code-wrap > .copy-button[data-copy='idle']",
    );
    const timers: number[] = [];

    for (const button of buttons) {
      button.dataset.copy = "bound";
      const pre = button.parentElement?.querySelector("pre");
      if (!pre) continue;

      button.addEventListener("click", async () => {
        await writeClipboard(pre.textContent ?? "");
        setState(button, true);
        timers.push(window.setTimeout(() => setState(button, false), 1800));
      });
    }

    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [pathname]);

  return null;
}
