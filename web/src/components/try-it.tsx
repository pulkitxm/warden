"use client";

import { useState } from "react";
import { FIXTURE_VERDICTS, findFixture } from "@/lib/fixtures";

const TONE = {
  allow: { badge: "bg-mint text-navy", text: "text-mint", label: "ALLOW" },
  warn: { badge: "bg-[#edbd55] text-navy", text: "text-[#edbd55]", label: "WARN" },
  block: { badge: "bg-coral text-navy", text: "text-coral", label: "BLOCK" },
} as const;

export function TryIt() {
  const [query, setQuery] = useState("lodahs");
  const result = findFixture(query);

  return (
    <div className="rounded-2xl border border-white/12 bg-navy-soft/50 p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        {FIXTURE_VERDICTS.map((entry) => (
          <button
            key={entry.spec}
            type="button"
            onClick={() => setQuery(entry.spec)}
            className={`rounded-lg border px-2.5 py-1 font-mono text-[12px] transition ${
              result?.spec === entry.spec
                ? "border-mint/50 bg-mint/10 text-mint"
                : "border-white/12 text-fog hover:border-mint/40 hover:text-white"
            }`}
          >
            {entry.spec}
          </button>
        ))}
      </div>

      <label htmlFor="try-it" className="mt-5 block text-[12px] tracking-wide text-fog uppercase">
        Package to check
      </label>
      <div className="mt-2 flex items-center gap-2 rounded-xl border border-white/14 bg-[#070b16] px-3 py-2.5 font-mono text-[13px]">
        <span className="text-mint">$</span>
        <span className="text-fog">warden check</span>
        <input
          id="try-it"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-white outline-none placeholder:text-fog/50"
          placeholder="package-name"
        />
      </div>

      <div className="mt-4">
        {result ? (
          <div className="overflow-x-auto rounded-xl border border-white/12 bg-[#070b16] p-4 font-mono text-[12.5px] leading-relaxed">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${TONE[result.verdict].badge}`}
              >
                {TONE[result.verdict].label}
              </span>
              <span className="font-semibold text-white">{result.spec}</span>
              <span className="text-fog">
                risk {result.risk}/100 · {result.source}
              </span>
            </div>
            {result.categories.length ? (
              <p className="mt-2 text-fog">categories: {result.categories.join(", ")}</p>
            ) : null}
            {result.headline ? (
              <p className={`mt-2 ${TONE[result.verdict].text}`}>{result.headline}</p>
            ) : null}
            <ul className="mt-2 space-y-1">
              {result.evidence.map((item) => (
                <li key={item} className="text-[#c3cbdf]">
                  <span className={TONE[result.verdict].text}>•</span> {item}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-white">
              <span className="font-semibold">verdict:</span> {result.summary}
            </p>
            <p className="mt-2 text-fog">exit {result.exit}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-white/14 bg-[#070b16] p-4 text-[13px] leading-relaxed text-fog">
            This page ships fixture verdicts only, so it never contacts a registry and no live
            malware is involved. Pick one of the examples above, or run{" "}
            <code className="rounded bg-white/8 px-1.5 py-0.5 font-mono text-[12px] text-[#ffd9d3]">
              warden check {query.trim() || "<package>"}
            </code>{" "}
            locally for a real verdict.
          </div>
        )}
      </div>
    </div>
  );
}
