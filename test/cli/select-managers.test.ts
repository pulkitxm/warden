import { expect, test } from "bun:test";
import {
  COMMAND_REGISTRY,
  defaultManagerTerminal,
  defaultWardenDeps,
  type ManagerTerminal,
  reduceManagerSelection,
  runWarden,
  selectManagers,
  type WardenDeps,
} from "../../src/cli/main.ts";

function deps(over: Partial<WardenDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const value: WardenDeps = {
    ...defaultWardenDeps,
    home: "/home/test",
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    ...over,
  };
  return { value, out, err };
}

test("select-managers returns every detected manager without a TTY", async () => {
  const state = deps({
    isTTY: () => false,
    selectManagers: () => Promise.reject(new Error("unexpected selector")),
  });
  expect(await runWarden(["select-managers", "--detected", "npm bun pnpm"], state.value)).toBe(0);
  expect(state.out).toEqual(["npm bun pnpm\n"]);
});

test("select-managers parses selection and accepts empty detected input", async () => {
  const selected = deps({ isTTY: () => true, selectManagers: () => Promise.resolve(["bun"]) });
  expect(await runWarden(["select-managers", "--detected", " npm   bun "], selected.value)).toBe(0);
  expect(selected.out).toEqual(["bun\n"]);

  const empty = deps({
    isTTY: () => true,
    selectManagers: () => Promise.reject(new Error("unexpected selector")),
  });
  expect(await runWarden(["select-managers", "--detected", ""], empty.value)).toBe(0);
  expect(empty.out).toEqual(["\n"]);

  const cancelled = deps({
    isTTY: () => true,
    selectManagers: () => Promise.reject(new Error("cancelled")),
  });
  expect(await runWarden(["select-managers", "--detected", "npm"], cancelled.value)).toBe(30);
  expect(cancelled.err).toEqual(["warden: manager selection cancelled\n"]);
});

test("select-managers is hidden but remains invokable", () => {
  expect(COMMAND_REGISTRY.find((command) => command.name === "select-managers")?.hidden).toBe(true);
});

test("manager key reducer handles movement, toggles, confirmation, cancellation, and noise", () => {
  const initial = { cursor: 0, selected: [true, true, true], done: null };
  const changed = reduceManagerSelection(initial, "x\u001b[A \u001b[B \r");
  expect(changed).toEqual({ cursor: 0, selected: [false, true, false], done: "confirm" });
  expect(reduceManagerSelection(initial, "\u0003").done).toBe("cancel");
  expect(reduceManagerSelection(initial, "\n").done).toBe("confirm");
});

function terminal(sequence: string[], signal = false, failWrite = false) {
  const raw: boolean[] = [];
  const lifecycle: string[] = [];
  let inputCleanup = false;
  let signalCleanup = false;
  const value: ManagerTerminal = {
    raw: (enabled) => raw.push(enabled),
    resume: () => lifecycle.push("resume"),
    pause: () => lifecycle.push("pause"),
    write: () => {
      if (failWrite) throw new Error("render failed");
    },
    input: (handler) => {
      for (const item of sequence) queueMicrotask(() => handler(item));
      return () => {
        inputCleanup = true;
      };
    },
    interrupt: (handler) => {
      if (signal) queueMicrotask(handler);
      return () => {
        signalCleanup = true;
      };
    },
  };
  return {
    value,
    raw,
    lifecycle,
    cleaned: () => inputCleanup && signalCleanup,
  };
}

test("interactive manager selection renders changes and restores the terminal", async () => {
  const tty = terminal(["\u001b[B ", "\r"]);
  expect(await selectManagers(["npm", "bun"], tty.value)).toEqual(["npm"]);
  expect(tty.raw).toEqual([true, false]);
  expect(tty.lifecycle).toEqual(["resume", "pause"]);
  expect(tty.cleaned()).toBe(true);
});

test("interactive manager selection restores the terminal on ctrl-c, SIGINT, and error", async () => {
  for (const tty of [terminal(["\u0003"]), terminal([], true), terminal([], false, true)]) {
    await expect(selectManagers(["npm"], tty.value)).rejects.toThrow();
    expect(tty.raw).toEqual([true, false]);
    expect(tty.lifecycle).toEqual(["resume", "pause"]);
    expect(tty.cleaned()).toBe(true);
  }
});

test("default manager terminal delegates to stdin and stderr", () => {
  const stdin = process.stdin;
  const saved = Object.getOwnPropertyDescriptor(stdin, "setRawMode");
  const raw: boolean[] = [];
  Object.defineProperty(stdin, "setRawMode", {
    configurable: true,
    value: (enabled: boolean) => {
      raw.push(enabled);
      return stdin;
    },
  });
  defaultManagerTerminal.raw(true);
  defaultManagerTerminal.write("");
  defaultManagerTerminal.resume();
  defaultManagerTerminal.pause();
  const stopInput = defaultManagerTerminal.input(() => undefined);
  const stopInterrupt = defaultManagerTerminal.interrupt(() => undefined);
  process.stdin.emit("data", Buffer.from(""));
  stopInput();
  stopInterrupt();
  if (saved) Object.defineProperty(stdin, "setRawMode", saved);
  else delete (stdin as { setRawMode?: unknown }).setRawMode;
  expect(raw).toEqual([true]);
});

test("manager selection restores raw mode when terminal setup fails", async () => {
  const tty = terminal([]);
  tty.value.raw = (enabled) => {
    tty.raw.push(enabled);
    if (enabled) throw new Error("raw mode failed");
  };
  await expect(selectManagers(["npm"], tty.value)).rejects.toThrow("raw mode failed");
  expect(tty.raw).toEqual([true, false]);
});
