"use client";

import { useEffect, useState } from "react";

interface Example {
  name: string;
  version: string;
  verdict: string;
  score: string;
  command: string;
  state: "allow" | "warn" | "block";
  reason: string;
}

const EXAMPLES: Example[] = [
  {
    name: "lodahs",
    version: "@0.0.1",
    verdict: "BLOCK",
    score: "risk 60 / 100",
    command: "npm install lodahs",
    state: "block",
    reason: "typosquat: one edit from lodash",
  },
  {
    name: "left-pad",
    version: "@1.3.0",
    verdict: "ALLOW",
    score: "risk 10 / 100",
    command: "pnpm add left-pad",
    state: "allow",
    reason: "clean: no dangerous capability found",
  },
  {
    name: "chalk",
    version: "@5.6.1",
    verdict: "BLOCK",
    score: "risk 100 / 100",
    command: "bun add chalk@5.6.1",
    state: "block",
    reason: "known_malware: blocklist entry MAL-CHALK-2025",
  },
  {
    name: "react-codeshift",
    version: "@unknown",
    verdict: "BLOCK",
    score: "risk 90 / 100",
    command: "npx react-codeshift",
    state: "block",
    reason: "slopsquat: invented package name",
  },
  {
    name: "axios",
    version: "@1.14.1",
    verdict: "BLOCK",
    score: "risk 92 / 100",
    command: "npm install axios@1.14.1",
    state: "block",
    reason: "provenance_downgrade: trusted publisher abandoned",
  },
];

export function Checkpoint() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % EXAMPLES.length);
    }, 3800);
    return () => window.clearInterval(timer);
  }, []);

  const example = EXAMPLES[index] as Example;

  return (
    <div className="checkpoint">
      <div className="checkpoint-top">
        <span className="window-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>preflight / package intake</span>
        <span className="live-status">
          <i />
          armed
        </span>
      </div>

      <div className="checkpoint-stage">
        <div className="radar-grid" aria-hidden="true" />
        <div className="sweep" aria-hidden="true" />
        <div className="orbit orbit-one" aria-hidden="true" />
        <div className="orbit orbit-two" aria-hidden="true" />
        <div className="scan-beam" aria-hidden="true" />

        <div className="package-card">
          <small>incoming</small>
          <strong>{example.name}</strong>
          <span>{example.version}</span>
        </div>

        <div className={`verdict-stamp is-${example.state}`}>
          <small>verdict</small>
          <strong>{example.verdict}</strong>
          <span>{example.score}</span>
        </div>

        <span className="signal signal-one" aria-hidden="true" />
        <span className="signal signal-two" aria-hidden="true" />
        <span className="signal signal-three" aria-hidden="true" />
      </div>

      <div className="checkpoint-log" aria-live="polite">
        <span>$</span>
        <code className="min-w-0 truncate">{example.command}</code>
        <i />
      </div>
      <div className="border-t border-white/10 bg-[#070b16] px-4.5 py-2.5 font-mono text-[11.5px] text-fog">
        {example.reason}
      </div>
    </div>
  );
}
