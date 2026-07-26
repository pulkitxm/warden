export type SearchKind = "page" | "section" | "command";

export interface SearchRecord {
  id: string;
  kind: SearchKind;
  title: string;
  page: string;
  section: string;
  path: string;
  text: string;
  keywords: string;
}

export interface PreparedRecord {
  record: SearchRecord;
  title: string;
  page: string;
  section: string;
  keywords: string;
  text: string;
}

export interface SearchResult {
  kind: SearchKind;
  title: string;
  page: string;
  section: string;
  path: string;
  excerpt: string;
  score: number;
}

const FIELD_WEIGHT = { title: 100, keywords: 46, page: 34, section: 16, text: 30 } as const;
const KIND_BONUS: Record<SearchKind, number> = { page: 14, command: 11, section: 0 };
const MAX_TOKENS = 8;
const EXCERPT_RADIUS = 80;
const EXCERPT_LENGTH = 190;

export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9@._/-]+/)
    .filter((token) => token.length > 0)
    .slice(0, MAX_TOKENS);
}

export function prepare(records: SearchRecord[]): PreparedRecord[] {
  return records.map((record) => ({
    record,
    title: record.title.toLowerCase(),
    page: record.page.toLowerCase(),
    section: record.section.toLowerCase(),
    keywords: record.keywords.toLowerCase(),
    text: record.text.toLowerCase(),
  }));
}

function alphanumeric(value: string | undefined): boolean {
  return value !== undefined && /[a-z0-9]/.test(value);
}

function fieldScore(haystack: string, token: string, weight: number): number {
  if (haystack.length === 0) return 0;
  const index = haystack.indexOf(token);
  if (index === -1) return 0;
  if (haystack === token) return weight * 1.3;
  if (index === 0 || !alphanumeric(haystack[index - 1])) {
    return weight * (alphanumeric(haystack[index + token.length]) ? 0.82 : 1);
  }
  return weight * 0.42;
}

function subsequenceScore(haystack: string, token: string, weight: number): number {
  if (haystack.length === 0 || token.length < 3) return 0;
  let cursor = -1;
  let start = -1;
  for (const character of token) {
    cursor = haystack.indexOf(character, cursor + 1);
    if (cursor === -1) return 0;
    if (start === -1) start = cursor;
  }
  return weight * 0.3 * (token.length / (cursor - start + 1));
}

function occurrences(haystack: string, token: string): number {
  let count = 0;
  let index = haystack.indexOf(token);
  while (index !== -1 && count < 3) {
    count += 1;
    index = haystack.indexOf(token, index + token.length);
  }
  return count;
}

function scoreRecord(entry: PreparedRecord, tokens: string[], phrase: string): number {
  let total = 0;
  for (const token of tokens) {
    const direct = Math.max(
      fieldScore(entry.title, token, FIELD_WEIGHT.title),
      fieldScore(entry.keywords, token, FIELD_WEIGHT.keywords),
      fieldScore(entry.page, token, FIELD_WEIGHT.page),
      fieldScore(entry.section, token, FIELD_WEIGHT.section),
      fieldScore(entry.text, token, FIELD_WEIGHT.text),
    );
    if (direct > 0) {
      total += direct + occurrences(entry.text, token) * 2;
      continue;
    }
    const fuzzy = Math.max(
      subsequenceScore(entry.title, token, FIELD_WEIGHT.title),
      subsequenceScore(entry.keywords, token, FIELD_WEIGHT.keywords),
    );
    if (fuzzy === 0) return 0;
    total += fuzzy;
  }
  if (tokens.length > 1) {
    if (entry.title.includes(phrase)) total += 70;
    else if (entry.text.includes(phrase)) total += 24;
  }
  return total + KIND_BONUS[entry.record.kind];
}

function trimToWord(value: string): string {
  const index = value.lastIndexOf(" ");
  return index > EXCERPT_LENGTH / 3 ? value.slice(0, index) : value;
}

export function excerptOf(text: string, tokens: string[]): string {
  if (text.length === 0) return "";
  const lower = text.toLowerCase();
  let hit = -1;
  for (const token of tokens) {
    const found = lower.indexOf(token);
    if (found !== -1 && (hit === -1 || found < hit)) hit = found;
  }
  if (hit <= EXCERPT_RADIUS) {
    return text.length <= EXCERPT_LENGTH ? text : `${trimToWord(text.slice(0, EXCERPT_LENGTH))}…`;
  }
  const space = text.indexOf(" ", hit - EXCERPT_RADIUS);
  const start = space !== -1 && space < hit ? space + 1 : hit - EXCERPT_RADIUS;
  const slice = text.slice(start, start + EXCERPT_LENGTH);
  const tail = start + EXCERPT_LENGTH < text.length ? `${trimToWord(slice)}…` : slice;
  return `…${tail}`;
}

export function search(entries: PreparedRecord[], query: string, limit = 12): SearchResult[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const phrase = query.trim().toLowerCase();

  const scored: Array<{ entry: PreparedRecord; score: number }> = [];
  for (const entry of entries) {
    const score = scoreRecord(entry, tokens, phrase);
    if (score > 0) scored.push({ entry, score });
  }
  scored.sort(
    (a, b) => b.score - a.score || a.entry.record.path.length - b.entry.record.path.length,
  );

  return scored.slice(0, limit).map(({ entry, score }) => ({
    kind: entry.record.kind,
    title: entry.record.title,
    page: entry.record.page,
    section: entry.record.section,
    path: entry.record.path,
    excerpt: excerptOf(entry.record.text, tokens),
    score: Math.round(score),
  }));
}
