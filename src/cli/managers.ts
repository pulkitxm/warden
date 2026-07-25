export interface ManagerSelection {
  cursor: number;
  selected: boolean[];
  done: "confirm" | "cancel" | null;
}

export interface ManagerTerminal {
  raw: (enabled: boolean) => unknown;
  resume: () => unknown;
  pause: () => unknown;
  write: (value: string) => unknown;
  input: (handler: (value: string) => void) => () => void;
  interrupt: (handler: () => void) => () => void;
}

export function reduceManagerSelection(state: ManagerSelection, input: string): ManagerSelection {
  const next = { ...state, selected: [...state.selected] };
  for (let index = 0; index < input.length && !next.done; index++) {
    const key = input.slice(index, index + 3);
    if (key === "\u001b[A") {
      next.cursor = (next.cursor - 1 + next.selected.length) % next.selected.length;
      index += 2;
    } else if (key === "\u001b[B") {
      next.cursor = (next.cursor + 1) % next.selected.length;
      index += 2;
    } else if (input[index] === " ") {
      next.selected[next.cursor] = !next.selected[next.cursor];
    } else if (input[index] === "\r" || input[index] === "\n") {
      next.done = "confirm";
    } else if (input[index] === "\u0003") {
      next.done = "cancel";
    }
  }
  return next;
}

export const defaultManagerTerminal: ManagerTerminal = {
  raw: (enabled) => process.stdin.setRawMode(enabled),
  resume: () => process.stdin.resume(),
  pause: () => process.stdin.pause(),
  write: process.stderr.write.bind(process.stderr),
  input: (handler) => {
    const listener = (value: Buffer) => handler(value.toString());
    process.stdin.on("data", listener);
    return () => process.stdin.off("data", listener);
  },
  interrupt: (handler) => {
    process.once("SIGINT", handler);
    return () => process.off("SIGINT", handler);
  },
};

export async function selectManagers(
  names: string[],
  terminal: ManagerTerminal = defaultManagerTerminal,
): Promise<string[]> {
  let state: ManagerSelection = {
    cursor: 0,
    selected: names.map(() => true),
    done: null,
  };
  let first = true;
  let stopInput: (() => void) | undefined;
  let stopInterrupt: (() => void) | undefined;
  const render = () => {
    const rewind = first ? "" : `\u001b[${names.length + 2}A`;
    first = false;
    terminal.write(
      `${rewind}\u001b[2KWhich detected package managers should warden intercept?\n${names
        .map(
          (name, index) =>
            `\u001b[2K${state.cursor === index ? ">" : " "} ${state.selected[index] ? "[x]" : "[ ]"} ${name}`,
        )
        .join("\n")}\n\u001b[2KUp/down move, space toggles, enter confirms\n`,
    );
  };
  try {
    terminal.raw(true);
    terminal.resume();
    const result = await new Promise<string[]>((resolve, reject) => {
      stopInput = terminal.input((input) => {
        state = reduceManagerSelection(state, input);
        if (state.done === "cancel") {
          reject(new Error("manager selection cancelled"));
          return;
        }
        if (state.done === "confirm") {
          resolve(names.filter((_, index) => state.selected[index]));
          return;
        }
        render();
      });
      stopInterrupt = terminal.interrupt(() => reject(new Error("manager selection cancelled")));
      render();
    });
    return result;
  } finally {
    stopInput?.();
    stopInterrupt?.();
    terminal.raw(false);
    terminal.pause();
  }
}
