"use client";

import { useEffect, useRef, useState } from "react";

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.2-8.56" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function OpenAiIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
      <path d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A5.98 5.98 0 0 0 10.7.53a6.05 6.05 0 0 0-5.77 4.19 5.98 5.98 0 0 0-4 2.9 6.05 6.05 0 0 0 .75 7.09 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.98 5.98 0 0 0 13.3 23.5a6.05 6.05 0 0 0 5.77-4.2 5.98 5.98 0 0 0 4-2.9 6.05 6.05 0 0 0-.75-7.08Zm-9 12.55a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.78.78 0 0 0 .4-.68V11.1l2.02 1.17a.07.07 0 0 1 .04.05v5.58a4.5 4.5 0 0 1-4.5 4.47ZM3.64 18.24a4.47 4.47 0 0 1-.54-3.01l.14.09 4.79 2.76a.78.78 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06l-4.84 2.8a4.5 4.5 0 0 1-6.14-1.66ZM2.39 8.3a4.48 4.48 0 0 1 2.35-1.97v5.68a.77.77 0 0 0 .39.67l5.81 3.36-2.02 1.16a.07.07 0 0 1-.07 0l-4.84-2.79A4.5 4.5 0 0 1 2.39 8.3Zm16.6 3.86-5.83-3.4L15.17 7.6a.07.07 0 0 1 .07 0l4.84 2.8a4.49 4.49 0 0 1-.68 8.1v-5.67a.78.78 0 0 0-.4-.67Zm2.01-3.03-.14-.08-4.78-2.79a.78.78 0 0 0-.79 0L9.46 9.63V7.3a.07.07 0 0 1 .03-.06l4.84-2.79a4.5 4.5 0 0 1 6.68 4.66ZM8.36 13.3l-2.02-1.16a.08.08 0 0 1-.04-.06V6.51a4.5 4.5 0 0 1 7.38-3.45l-.14.08-4.78 2.76a.78.78 0 0 0-.4.68v6.71Zm1.1-2.37 2.6-1.5 2.61 1.5v3l-2.6 1.5-2.61-1.5v-3Z" />
    </svg>
  );
}

function ClaudeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
      <path d="M12 1.4 13.9 8l4.7-4.7-2.4 6.4 6.4-2.4L17.9 10l6.6 1.9-6.6 1.9 4.7 4.7-6.4-2.4 2.4 6.4L13.9 16 12 22.6 10.1 16l-4.7 4.7 2.4-6.4-6.4 2.4L6.1 12l-6.6-1.9L6.1 8.2 1.4 3.5l6.4 2.4-2.4-6.4L10.1 8 12 1.4Z" />
    </svg>
  );
}

const COPY_STATES = {
  idle: { icon: <CopyIcon />, label: "Copy Markdown", tone: "text-fog" },
  loading: { icon: <SpinnerIcon />, label: "Copying", tone: "text-fog" },
  copied: { icon: <CheckIcon />, label: "Copied", tone: "text-mint" },
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
        <ChevronIcon />
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
            <EyeIcon />
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
            <OpenAiIcon />
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
            <ClaudeIcon />
            Open in Claude
          </a>
        </div>
      ) : null}
    </div>
  );
}
