import { c, dim } from "./ansi.ts";
import { isQuiet } from "./output.ts";

export interface ProgressIo {
  write: (s: string) => unknown;
  tty: boolean;
  now: () => number;
  interval: (fn: () => void, ms: number) => { stop: () => void };
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const PAINT_MS = 100;
const ANNOUNCE_MS = 2_000;
const HEARTBEAT_MS = 15_000;
const KEEP_MS = 1_000;

interface State {
  io: ProgressIo;
  timer: { stop: () => void };
  step: string;
  detail: string;
  count: string;
  startedAt: number;
  frame: number;
  painted: boolean;
  paused: boolean;
  beat: number;
}

let state: State | null = null;

function elapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`;
}

function line(s: State): string {
  const parts = [s.step];
  if (s.count) parts.push(s.count);
  if (s.detail) parts.push(s.detail);
  return parts.join(" · ");
}

function clear(s: State): void {
  if (s.painted) {
    s.io.write("\r\x1b[2K");
    s.painted = false;
  }
}

function paint(): void {
  const s = state;
  if (!s?.step || s.paused) return;
  const age = s.io.now() - s.startedAt;
  if (!s.io.tty) {
    const due = s.beat ? s.beat + HEARTBEAT_MS : ANNOUNCE_MS;
    if (age < due) return;
    s.beat = age;
    s.io.write(`  ${line(s)} (${elapsed(age)})\n`);
    return;
  }
  s.frame = (s.frame + 1) % FRAMES.length;
  s.io.write(`\r\x1b[2K${FRAMES[s.frame]} ${line(s)} ${dim(elapsed(age))}`);
  s.painted = true;
}

function finish(s: State): void {
  const took = s.io.now() - s.startedAt;
  clear(s);
  if (!s.step || took < KEEP_MS) return;
  const mark = s.io.tty ? c("32", "✓") : " ok";
  s.io.write(`${mark} ${s.step}${s.count ? ` · ${s.count}` : ""} ${dim(elapsed(took))}\n`);
}

export function startProgress(io: ProgressIo): void {
  if (state) stopProgress();
  state = {
    io,
    timer: io.interval(paint, PAINT_MS),
    step: "",
    detail: "",
    count: "",
    startedAt: io.now(),
    frame: 0,
    painted: false,
    paused: false,
    beat: 0,
  };
}

export function withoutProgress<T>(run: () => T): T {
  const s = state;
  if (!s) return run();
  clear(s);
  s.paused = true;
  try {
    return run();
  } finally {
    s.paused = false;
  }
}

export function progressStep(label: string): void {
  const s = state;
  if (!s || isQuiet()) return;
  finish(s);
  clear(s);
  s.step = label;
  s.detail = "";
  s.count = "";
  s.startedAt = s.io.now();
  s.beat = 0;
  if (s.io.tty) paint();
}

export function flushProgress(): void {
  const s = state;
  if (!s?.step) return;
  finish(s);
  s.step = "";
  s.detail = "";
  s.count = "";
}

export function progressCount(done: number, total?: number): void {
  if (!state) return;
  state.count = total === undefined ? `${done}` : `${done}/${total}`;
}

export function progressDetail(text: string): void {
  if (!state) return;
  state.detail = text;
}

export function stopProgress(): void {
  const s = state;
  if (!s) return;
  state = null;
  s.timer.stop();
  finish(s);
}

export function defaultProgressIo(): ProgressIo {
  return {
    write: (s) => process.stderr.write(s),
    tty: Boolean(process.stderr.isTTY),
    now: () => Date.now(),
    interval: (fn, ms) => {
      const handle = setInterval(fn, ms);
      handle.unref?.();
      return { stop: () => clearInterval(handle) };
    },
  };
}

export function withProgress<T>(run: () => Promise<T>): Promise<T> {
  startProgress(defaultProgressIo());
  return run().finally(stopProgress);
}
