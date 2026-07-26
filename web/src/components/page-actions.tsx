"use client";

import { Check, ChevronDown, Copy, Eye, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { RiOpenaiFill } from "react-icons/ri";
import { SiClaude } from "react-icons/si";

const COPY_STATES = {
  idle: { icon: <Copy size={14} aria-hidden="true" />, label: "Copy Markdown", tone: "text-fog" },
  loading: {
    icon: <LoaderCircle size={14} strokeWidth={2.4} className="animate-spin" aria-hidden="true" />,
    label: "Copying",
    tone: "text-fog",
  },
  copied: {
    icon: <Check size={14} strokeWidth={2.4} aria-hidden="true" />,
    label: "Copied",
    tone: "text-mint",
  },
} as const;

type CopyState = keyof typeof COPY_STATES;

export function PageActions({ markdownPath, title }: { markdownPath: string; title: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", dismiss);
    };
  }, [open]);

  const copyMarkdown = async () => {
    if (state === "loading") return;
    setState("loading");
    try {
      const response = await fetch(markdownPath);
      const text = await response.text();
      await navigator.clipboard.writeText(text);
      setState("copied");
      window.setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("idle");
    }
  };

  const prompt = () => {
    const url =
      typeof window === "undefined"
        ? markdownPath
        : new URL(markdownPath, window.location.origin).href;
    return encodeURIComponent(`Read ${url} and help me with Warden's ${title} documentation.`);
  };

  const itemClass =
    "flex w-full items-center gap-2.5 px-3 py-2 text-[13px] text-fog transition hover:bg-mint/10 hover:text-mint";

  return (
    <div ref={container} className="relative inline-flex shrink-0">
      <button
        type="button"
        onClick={copyMarkdown}
        disabled={state === "loading"}
        aria-busy={state === "loading"}
        className="grid rounded-l-lg border border-white/14 bg-navy-soft/60 px-3 py-1.5 text-[13px] font-medium text-white transition *:col-start-1 *:row-start-1 hover:border-mint/50 hover:bg-mint/10 hover:text-mint disabled:opacity-70 disabled:hover:border-white/14 disabled:hover:bg-navy-soft/60 disabled:hover:text-white"
      >
        {Object.entries(COPY_STATES).map(([key, { icon, label, tone }]) => (
          <span
            key={key}
            aria-hidden={key !== state}
            className={`flex items-center justify-center gap-2 transition-opacity duration-150 ${
              key === state ? "delay-150" : "opacity-0"
            }`}
          >
            <span className={tone}>{icon}</span>
            {label}
          </span>
        ))}
      </button>
      <button
        type="button"
        aria-label="More page actions"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center rounded-r-lg border border-l-0 border-white/14 bg-navy-soft/60 px-2 py-1.5 text-fog transition hover:border-mint/50 hover:bg-mint/10 hover:text-mint"
      >
        <ChevronDown size={14} aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute top-full right-0 z-30 mt-1.5 w-56 overflow-hidden rounded-xl border border-white/14 bg-[#0e1424] py-1 shadow-2xl shadow-black/50"
        >
          <a
            role="menuitem"
            href={markdownPath}
            className={itemClass}
            onClick={() => setOpen(false)}
          >
            <Eye size={15} strokeWidth={1.8} aria-hidden="true" className="shrink-0" />
            View as Markdown
          </a>
          <a
            role="menuitem"
            href={`https://chatgpt.com/?q=${prompt()}`}
            target="_blank"
            rel="noreferrer"
            className={itemClass}
            onClick={() => setOpen(false)}
          >
            <RiOpenaiFill size={15} aria-hidden="true" className="shrink-0" />
            Open in ChatGPT
          </a>
          <a
            role="menuitem"
            href={`https://claude.ai/new?q=${prompt()}`}
            target="_blank"
            rel="noreferrer"
            className={itemClass}
            onClick={() => setOpen(false)}
          >
            <SiClaude size={15} aria-hidden="true" className="shrink-0" />
            Open in Claude
          </a>
        </div>
      ) : null}
    </div>
  );
}
