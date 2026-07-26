"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const COPY_LABEL = "Copy";
const DONE_LABEL = "Copied";

function setState(button: HTMLButtonElement, done: boolean): void {
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
