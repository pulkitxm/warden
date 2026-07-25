"use client";

import { useState } from "react";

export function PageActions({ markdownPath, title }: { markdownPath: string; title: string }) {
  const [copied, setCopied] = useState(false);

  const absoluteMarkdown = () =>
    typeof window === "undefined" ? markdownPath : new URL(markdownPath, window.location.origin).href;

  const copyPage = async () => {
    const response = await fetch(markdownPath);
    const text = await response.text();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const askPrompt = () =>
    encodeURIComponent(
      `Read ${absoluteMarkdown()} and help me use Warden's ${title.toLowerCase()} documentation.`,
    );

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={copyPage}
        className={`rounded-lg border px-2.5 py-1.5 text-[12.5px] transition ${
          copied
            ? "border-mint/50 text-mint"
            : "border-white/14 text-fog hover:border-white/30 hover:text-white"
        }`}
      >
        {copied ? "Copied page" : "Copy page"}
      </button>
      <a
        href={markdownPath}
        className="rounded-lg border border-white/14 px-2.5 py-1.5 text-[12.5px] text-fog transition hover:border-white/30 hover:text-white"
      >
        View as markdown
      </a>
      <a
        href={`https://claude.ai/new?q=${askPrompt()}`}
        target="_blank"
        rel="noreferrer"
        className="rounded-lg border border-white/14 px-2.5 py-1.5 text-[12.5px] text-fog transition hover:border-white/30 hover:text-white"
      >
        Open in Claude
      </a>
      <a
        href={`https://chatgpt.com/?q=${askPrompt()}`}
        target="_blank"
        rel="noreferrer"
        className="rounded-lg border border-white/14 px-2.5 py-1.5 text-[12.5px] text-fog transition hover:border-white/30 hover:text-white"
      >
        Open in ChatGPT
      </a>
    </div>
  );
}
