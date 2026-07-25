import { afterEach, expect, test } from "bun:test";
import { setColor } from "../../src/shared/ansi.ts";
import { setVerbosity } from "../../src/shared/output.ts";
import {
  defaultProgressIo,
  flushProgress,
  type ProgressIo,
  progressCount,
  progressDetail,
  progressStep,
  startProgress,
  stopProgress,
  withoutProgress,
  withProgress,
} from "../../src/shared/progress.ts";

afterEach(() => {
  stopProgress();
  setVerbosity("normal");
});

function harness(tty: boolean) {
  const written: string[] = [];
  let clock = 0;
  let tick: (() => void) | null = null;
  let stopped = false;
  const io: ProgressIo = {
    write: (s) => written.push(s),
    tty,
    now: () => clock,
    interval: (fn) => {
      tick = fn;
      return {
        stop: () => {
          stopped = true;
        },
      };
    },
  };
  return {
    io,
    written,
    text: () => written.join(""),
    advance: (ms: number) => {
      clock += ms;
      tick?.();
    },
    stopped: () => stopped,
  };
}

test("a terminal run paints one line and rewrites it in place", () => {
  setColor(false);
  const h = harness(true);
  startProgress(h.io);
  progressStep("resolving the graph");
  progressCount(3, 40);
  progressDetail("left-pad");
  h.advance(200);

  const last = h.written.at(-1) as string;
  expect(last).toContain("resolving the graph · 3/40 · left-pad");
  expect(last).toStartWith("\r\x1b[2K");
});

test("a fast step leaves nothing behind, a slow one leaves a completed line", () => {
  setColor(false);
  const h = harness(true);
  startProgress(h.io);
  progressStep("fast");
  h.advance(100);
  progressStep("slow");
  progressCount(2, 2);
  h.advance(4_000);
  stopProgress();

  expect(h.text()).not.toContain("✓ fast");
  expect(h.text()).toContain("✓ slow · 2/2 4.0s\n");
  expect(h.stopped()).toBe(true);
});

test("without a terminal the step is announced once it is slow, then heartbeats", () => {
  setColor(false);
  const h = harness(false);
  startProgress(h.io);
  progressStep("resolving the graph");
  progressDetail("left-pad");

  h.advance(1_000);
  expect(h.text()).toBe("");

  h.advance(1_500);
  expect(h.text()).toBe("  resolving the graph · left-pad (2.5s)\n");

  h.advance(10_000);
  expect(h.text()).toBe("  resolving the graph · left-pad (2.5s)\n");

  h.advance(10_000);
  expect(h.text()).toContain("(22.5s)");

  stopProgress();
  expect(h.text()).toContain(" ok resolving the graph 22.5s\n");
});

test("elapsed time reads in milliseconds, seconds, and minutes", () => {
  setColor(false);
  const h = harness(true);
  startProgress(h.io);
  progressStep("work");
  h.advance(400);
  expect(h.written.at(-1)).toContain("400ms");
  h.advance(90_600);
  expect(h.written.at(-1)).toContain("1m31s");
});

test("nothing is written while progress is paused for a child process", () => {
  setColor(false);
  const h = harness(true);
  startProgress(h.io);
  progressStep("installing");
  h.advance(500);
  const before = h.written.length;

  const result = withoutProgress(() => {
    h.advance(5_000);
    return "child";
  });

  expect(result).toBe("child");
  expect(h.written[before]).toBe("\r\x1b[2K");
  expect(h.written.length).toBe(before + 1);
});

test("a report flushes the phase above it instead of landing after it", () => {
  setColor(false);
  const h = harness(true);
  startProgress(h.io);
  progressStep("vetting");
  progressCount(23);
  h.advance(3_000);

  flushProgress();
  flushProgress();
  h.advance(5_000);

  expect(h.text()).toEndWith("✓ vetting · 23 3.0s\n");
});

test("--quiet keeps every phase silent", () => {
  setColor(false);
  setVerbosity("quiet");
  const h = harness(true);
  startProgress(h.io);
  progressStep("resolving the graph");
  h.advance(5_000);
  stopProgress();
  expect(h.text()).toBe("");
});

test("the reporter is inert until it is started and after it is stopped", () => {
  progressStep("ignored");
  progressCount(1, 2);
  flushProgress();
  progressDetail("ignored");
  expect(withoutProgress(() => 7)).toBe(7);
  stopProgress();

  const h = harness(true);
  startProgress(h.io);
  startProgress(h.io);
  stopProgress();
  expect(h.text()).toBe("");
});

test("withProgress runs the command and stops the reporter afterwards", async () => {
  const io = defaultProgressIo();
  expect(typeof io.now()).toBe("number");
  expect(typeof io.tty).toBe("boolean");
  expect(io.write("")).toBe(true);
  const timer = io.interval(() => {}, 1_000);
  timer.stop();

  setVerbosity("quiet");
  expect(await withProgress(async () => "done")).toBe("done");
  await expect(withProgress(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
});
