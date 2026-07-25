export type TermToken = { text: string; cls?: string };

const RULES: Array<{ pattern: RegExp; cls: string }> = [
  { pattern: /\b(BLOCK|BLOCKED|UNFIXABLE|FAIL|failed|fail|REFUSED|ROLLED BACK)\b/g, cls: "t-block" },
  {
    pattern: /\b(ALLOW|APPLIED|passed|recommended|approved|verified|detected|ready|strong)\b/g,
    cls: "t-allow",
  },
  {
    pattern: /\b(WARN|NEEDS_APPROVAL|skipped|pending|partial|moderate|unknown)\b/g,
    cls: "t-warn",
  },
  { pattern: /\b(critical|high)\b/g, cls: "t-critical" },
  { pattern: /\b(moderate|medium|low)\b/g, cls: "t-warn" },
  { pattern: /\bok\b/g, cls: "t-allow" },
  { pattern: /\[[A-Z]+-[A-Z0-9-]+\]/g, cls: "t-dim" },
  { pattern: /\b[\w@./-]+@\d+\.\d+\.\d+[\w.-]*/g, cls: "t-pkg" },
  { pattern: /\b\d+ms\b/g, cls: "t-dim" },
  { pattern: /\bwtxn_[0-9a-f]+/g, cls: "t-pkg" },
  { pattern: /\bsha256:[0-9a-f.]+/g, cls: "t-dim" },
  { pattern: /\bsha512-[\w+/=.]+/g, cls: "t-dim" },
  { pattern: /\b\d+(?:\.\d+)?%/g, cls: "t-allow" },
  { pattern: /\bwarden [a-z-]+(?: [a-z-]+)?/g, cls: "t-head" },
  { pattern: /^\s*[+~=-] /gm, cls: "t-dim" },
  { pattern: /\b(weak|none|absent|info)\b/g, cls: "t-dim" },
  { pattern: /(^|\s)(->|→)(\s|$)/g, cls: "t-dim" },
  { pattern: /^\s*\$\s/gm, cls: "t-prompt" },
];

export function classifyLine(line: string): TermToken[] {
  const marks: Array<{ start: number; end: number; cls: string }> = [];

  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    let match = rule.pattern.exec(line);
    while (match !== null) {
      const start = match[0].length === match[0].trimStart().length ? match.index : match.index + (match[0].length - match[0].trimStart().length);
      const end = match.index + match[0].length;
      if (!marks.some((mark) => start < mark.end && end > mark.start)) {
        marks.push({ start, end, cls: rule.cls });
      }
      match = rule.pattern.exec(line);
    }
  }

  if (/^\s*(supply-chain gate|plan |[0-9]+ issue)/.test(line)) {
    return [{ text: line, cls: "t-head" }];
  }
  if (/^(WARDEN [A-Z]+|Warden [a-z]+)\b/.test(line)) {
    return [{ text: line, cls: "t-head" }];
  }
  if (/^\s*(Direct changes|Graph changes|Execution surface|Analysis coverage|Next action|Decision|What changed|Why that matters|Prevented|Analysis limits|Safe next action|Method|Files|Enforcement layers|Native settings|Not natively supported|Not supported by this agent|Enforced by warden|Verification|Intent|Trusted baselines|Install scripts)\b/.test(
      line,
    )
  ) {
    return [{ text: line, cls: "t-head" }];
  }
  if (/^\s*note:/.test(line)) {
    return [{ text: line, cls: "t-dim" }];
  }

  marks.sort((a, b) => a.start - b.start);

  const tokens: TermToken[] = [];
  let cursor = 0;
  for (const mark of marks) {
    if (mark.start > cursor) tokens.push({ text: line.slice(cursor, mark.start) });
    tokens.push({ text: line.slice(mark.start, mark.end), cls: mark.cls });
    cursor = mark.end;
  }
  if (cursor < line.length) tokens.push({ text: line.slice(cursor) });
  return tokens.length ? tokens : [{ text: line }];
}

export function classifyTerminal(text: string): TermToken[][] {
  return text.replace(/\n$/, "").split("\n").map(classifyLine);
}
