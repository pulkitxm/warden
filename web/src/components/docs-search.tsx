"use client";

import { CornerDownLeft, FileText, Hash, Search, Terminal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  type PreparedRecord,
  prepare,
  type SearchRecord,
  type SearchResult,
  search,
  tokenize,
} from "@/lib/search";

const RECENT_KEY = "warden:docs:recent";
const RECENT_LIMIT = 5;
const RESULT_LIMIT = 14;
const HIGHLIGHT_LIMIT = 40;

const STARTERS: SearchResult[] = [
  {
    kind: "page",
    title: "Getting started",
    page: "Getting started",
    section: "Start",
    path: "/docs/getting-started",
    excerpt: "Install the binaries, vet a package, install through Warden, put it in CI.",
    score: 0,
  },
  {
    kind: "page",
    title: "Concepts",
    page: "Concepts",
    section: "Start",
    path: "/docs/concepts",
    excerpt: "Verdicts, exit codes, categories, and the gate-then-verify loop.",
    score: 0,
  },
  {
    kind: "page",
    title: "Transactions",
    page: "Transactions",
    section: "Using Warden",
    path: "/docs/transactions",
    excerpt: "Plan, approve, apply, verify, receipt.",
    score: 0,
  },
  {
    kind: "page",
    title: "CLI reference",
    page: "CLI reference",
    section: "CLI",
    path: "/docs/cli",
    excerpt: "Every verb, generated from the command registry.",
    score: 0,
  },
];

let indexRequest: Promise<PreparedRecord[]> | null = null;

function loadIndex(): Promise<PreparedRecord[]> {
  if (!indexRequest) {
    indexRequest = fetch("/api/search-index")
      .then((response) => {
        if (!response.ok) throw new Error(`search index responded ${response.status}`);
        return response.json() as Promise<{ records: SearchRecord[] }>;
      })
      .then((payload) => prepare(payload.records))
      .catch((error: unknown) => {
        indexRequest = null;
        throw error;
      });
  }
  return indexRequest;
}

function readRecent(): SearchResult[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is SearchResult =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as SearchResult).path === "string" &&
        typeof (entry as SearchResult).title === "string",
    );
  } catch {
    return [];
  }
}

function writeRecent(result: SearchResult): void {
  try {
    const next = [result, ...readRecent().filter((entry) => entry.path !== result.path)].slice(
      0,
      RECENT_LIMIT,
    );
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    return;
  }
}

function whenIdle(task: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(task, { timeout: 2500 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(task, 1200);
  return () => window.clearTimeout(handle);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

function Highlight({ text, tokens }: { text: string; tokens: string[] }): ReactNode {
  if (tokens.length === 0 || text.length === 0) return text;

  const lower = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const token of tokens) {
    let index = lower.indexOf(token);
    while (index !== -1 && ranges.length < HIGHLIGHT_LIMIT) {
      ranges.push([index, index + token.length]);
      index = lower.indexOf(token, index + token.length);
    }
  }
  if (ranges.length === 0) return text;

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }

  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark key={`${start}-${end}`} className="rounded-sm bg-mint/20 px-0.5 text-mint">
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function ResultIcon({ kind }: { kind: SearchResult["kind"] }) {
  const props = { size: 15, strokeWidth: 1.8, "aria-hidden": true, className: "shrink-0" } as const;
  if (kind === "command") return <Terminal {...props} />;
  if (kind === "section") return <Hash {...props} />;
  return <FileText {...props} />;
}

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<PreparedRecord[] | null>(null);
  const [remote, setRemote] = useState<SearchResult[] | null>(null);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<SearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const trimmed = query.trim();
  const tokens = useMemo(() => tokenize(query), [query]);
  const local = useMemo(() => (index ? search(index, query, RESULT_LIMIT) : null), [index, query]);
  const results = local ?? remote ?? [];
  const rows = trimmed.length === 0 ? (recent.length > 0 ? recent : STARTERS) : results;
  const activeRow = rows[active];

  useEffect(() => {
    setRecent(readRecent());
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let live = true;
    loadIndex()
      .then((records) => {
        if (live) setIndex(records);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (index || trimmed.length === 0) {
      setRemote(null);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/search?q=${encodeURIComponent(trimmed)}&limit=${RESULT_LIMIT}`, {
      signal: controller.signal,
    })
      .then((response) => response.json() as Promise<{ results: SearchResult[] }>)
      .then((payload) => setRemote(payload.results))
      .catch(() => undefined);
    return () => controller.abort();
  }, [index, trimmed]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new query restarts the selection at the top
  useEffect(() => {
    setActive(0);
  }, [query]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the highlighted row is read from the DOM after it moves
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    node?.scrollIntoView({ block: "nearest" });
  }, [active]);

  useEffect(() => {
    if (!activeRow) return;
    try {
      router.prefetch(activeRow.path.split("#")[0]);
    } catch {
      return;
    }
  }, [activeRow, router]);

  useEffect(() => {
    const { body, documentElement } = document;
    const gutter = window.innerWidth - documentElement.clientWidth;
    const overflow = body.style.overflow;
    const padding = body.style.paddingRight;
    body.style.overflow = "hidden";
    if (gutter > 0) body.style.paddingRight = `${gutter}px`;
    return () => {
      body.style.overflow = overflow;
      body.style.paddingRight = padding;
    };
  }, []);

  const go = useCallback(
    (result: SearchResult) => {
      writeRecent(result);
      onClose();
    },
    [onClose],
  );

  const openActive = useCallback(() => {
    listRef.current?.querySelector<HTMLAnchorElement>('[data-active="true"]')?.click();
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown" || (event.key === "n" && event.ctrlKey)) {
      event.preventDefault();
      setActive((value) => (rows.length === 0 ? 0 : (value + 1) % rows.length));
      return;
    }
    if (event.key === "ArrowUp" || (event.key === "p" && event.ctrlKey)) {
      event.preventDefault();
      setActive((value) => (rows.length === 0 ? 0 : (value - 1 + rows.length) % rows.length));
      return;
    }
    if (event.key === "Enter" && activeRow) {
      event.preventDefault();
      openActive();
    }
  };

  let lastGroup = "";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[14vh]">
      <button
        type="button"
        aria-label="Close search"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/65 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search documentation"
        onKeyDown={onKeyDown}
        className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-white/12 bg-[#0e1424] shadow-2xl shadow-black/60"
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-4">
          <Search size={16} aria-hidden="true" className="shrink-0 text-fog" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the docs"
            aria-label="Search the docs"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent py-4 text-[15px] text-white outline-none placeholder:text-fog/70"
          />
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md border border-white/12 px-1.5 py-0.5 font-mono text-[11px] text-fog transition hover:border-mint/40 hover:text-mint"
          >
            esc
          </button>
        </div>

        <ul ref={listRef} className="max-h-[min(58vh,26rem)] overflow-y-auto p-2">
          {rows.map((row, position) => {
            const group =
              trimmed.length === 0
                ? recent.length > 0
                  ? "Recent"
                  : "Start here"
                : row.kind === "command"
                  ? "CLI reference"
                  : row.page;
            const heading = group === lastGroup ? null : group;
            lastGroup = group;
            const isActive = position === active;

            return (
              <li key={row.path}>
                {heading ? (
                  <p className="px-3 pt-3 pb-1 text-[11px] font-medium tracking-wide text-fog/70 uppercase">
                    {heading}
                  </p>
                ) : null}
                <Link
                  href={row.path}
                  prefetch={isActive}
                  data-active={isActive}
                  onClick={() => go(row)}
                  onMouseMove={() => setActive(position)}
                  className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition ${
                    isActive ? "bg-mint/12 text-white" : "text-fog"
                  }`}
                >
                  <span className={`mt-0.5 ${isActive ? "text-mint" : "text-fog/70"}`}>
                    <ResultIcon kind={row.kind} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-[14px] font-medium ${
                        isActive ? "text-white" : "text-white/90"
                      }`}
                    >
                      <Highlight text={row.title} tokens={tokens} />
                    </span>
                    {row.excerpt ? (
                      <span className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-fog">
                        <Highlight text={row.excerpt} tokens={tokens} />
                      </span>
                    ) : null}
                  </span>
                  {isActive ? (
                    <CornerDownLeft
                      size={13}
                      aria-hidden="true"
                      className="mt-1 shrink-0 text-mint"
                    />
                  ) : null}
                </Link>
              </li>
            );
          })}

          {trimmed.length > 0 && rows.length === 0 ? (
            <li className="px-3 py-8 text-center text-[13.5px] text-fog">
              No matches for <span className="text-white">{trimmed}</span>. Try a command name, a
              flag, or a heading.
            </li>
          ) : null}
        </ul>

        <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-2.5 text-[11.5px] text-fog/80">
          <span className="flex items-center gap-3">
            <span>
              <kbd className="font-mono text-white/80">↑↓</kbd> navigate
            </span>
            <span>
              <kbd className="font-mono text-white/80">↵</kbd> open
            </span>
            <span>
              <kbd className="font-mono text-white/80">esc</kbd> close
            </span>
          </span>
          <span aria-live="polite">
            {trimmed.length === 0
              ? index
                ? ""
                : "loading index"
              : `${rows.length} result${rows.length === 1 ? "" : "s"}`}
          </span>
        </div>
      </div>
    </div>
  );
}

interface DocsSearchApi {
  open: () => void;
  warm: () => void;
}

const DocsSearchContext = createContext<DocsSearchApi | null>(null);

export function DocsSearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => whenIdle(() => void loadIndex().catch(() => undefined)), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        restoreTo.current = document.activeElement as HTMLElement | null;
        setOpen((value) => !value);
        return;
      }
      if (event.key === "/" && !open && !isTypingTarget(event.target)) {
        event.preventDefault();
        restoreTo.current = document.activeElement as HTMLElement | null;
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    restoreTo.current?.focus();
  }, []);

  const api = useMemo<DocsSearchApi>(
    () => ({
      open: () => {
        restoreTo.current = document.activeElement as HTMLElement | null;
        setOpen(true);
      },
      warm: () => void loadIndex().catch(() => undefined),
    }),
    [],
  );

  return (
    <DocsSearchContext.Provider value={api}>
      {children}
      {open && typeof document !== "undefined"
        ? createPortal(<Palette onClose={close} />, document.body)
        : null}
    </DocsSearchContext.Provider>
  );
}

export function DocsSearchTrigger({ className = "" }: { className?: string }) {
  const api = useContext(DocsSearchContext);
  const [meta, setMeta] = useState(false);

  useEffect(() => {
    setMeta(/mac|iphone|ipad|ipod/i.test(navigator.userAgent));
  }, []);

  if (!api) return null;

  return (
    <button
      type="button"
      onClick={api.open}
      onMouseEnter={api.warm}
      onFocus={api.warm}
      className={`flex w-full items-center gap-2 rounded-lg border border-white/12 bg-navy-soft/50 px-3 py-2 text-[13px] text-fog transition hover:border-mint/40 hover:text-mint ${className}`}
    >
      <Search size={14} aria-hidden="true" className="shrink-0" />
      <span className="flex-1 text-left">Search docs</span>
      <kbd className="shrink-0 rounded border border-white/12 px-1.5 py-0.5 font-mono text-[10.5px] text-fog/80">
        {meta ? "⌘" : "Ctrl"} K
      </kbd>
    </button>
  );
}
