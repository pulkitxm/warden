const CONTEXT = 3;

export interface DiffOp {
  kind: " " | "-" | "+";
  text: string;
}

export function diffOps(before: string[], after: string[]): DiffOp[] {
  const rows = before.length;
  const columns = after.length;
  const table: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(columns + 1).fill(0),
  );
  for (let row = rows - 1; row >= 0; row--) {
    for (let column = columns - 1; column >= 0; column--) {
      table[row]![column] =
        before[row] === after[column]
          ? table[row + 1]![column + 1]! + 1
          : Math.max(table[row + 1]![column]!, table[row]![column + 1]!);
    }
  }
  const ops: DiffOp[] = [];
  let row = 0;
  let column = 0;
  while (row < rows && column < columns) {
    if (before[row] === after[column]) {
      ops.push({ kind: " ", text: before[row]! });
      row++;
      column++;
    } else if (table[row + 1]![column]! >= table[row]![column + 1]!) {
      ops.push({ kind: "-", text: before[row]! });
      row++;
    } else {
      ops.push({ kind: "+", text: after[column]! });
      column++;
    }
  }
  while (row < rows) ops.push({ kind: "-", text: before[row++]! });
  while (column < columns) ops.push({ kind: "+", text: after[column++]! });
  return ops;
}

interface Group {
  from: number;
  to: number;
}

export function changeGroups(ops: DiffOp[]): Group[] {
  const changed = ops.flatMap((op, index) => (op.kind === " " ? [] : [index]));
  const groups: Group[] = [];
  for (const index of changed) {
    const last = groups.at(-1);
    if (last && index - last.to - 1 <= CONTEXT * 2) last.to = index;
    else groups.push({ from: index, to: index });
  }
  return groups;
}

function hunkText(ops: DiffOp[], group: Group): string {
  const start = Math.max(0, group.from - CONTEXT);
  const end = Math.min(ops.length - 1, group.to + CONTEXT);
  let oldStart = 1;
  let newStart = 1;
  for (let index = 0; index < start; index++) {
    if (ops[index]!.kind !== "+") oldStart++;
    if (ops[index]!.kind !== "-") newStart++;
  }
  const body: string[] = [];
  let oldCount = 0;
  let newCount = 0;
  for (let index = start; index <= end; index++) {
    const op = ops[index]!;
    body.push(`${op.kind}${op.text}`);
    if (op.kind !== "+") oldCount++;
    if (op.kind !== "-") newCount++;
  }
  const header = `@@ -${oldCount ? oldStart : 0},${oldCount} +${newCount ? newStart : 0},${newCount} @@`;
  return [header, ...body].join("\n");
}

export interface FileChange {
  path: string;
  before?: string;
  after?: string;
  renamedFrom?: string;
}

export function unifiedDiff(change: FileChange): string {
  const head = `diff --git a/${change.renamedFrom ?? change.path} b/${change.path}`;
  if (change.renamedFrom !== undefined && change.before === change.after) {
    return [
      head,
      "similarity index 100%",
      `rename from ${change.renamedFrom}`,
      `rename to ${change.path}`,
    ].join("\n");
  }
  const beforeLines =
    change.before === undefined ? [] : change.before.replace(/\n$/, "").split("\n");
  const afterLines = change.after === undefined ? [] : change.after.replace(/\n$/, "").split("\n");
  const meta: string[] = [head];
  if (change.before === undefined) meta.push("new file mode 100644");
  else if (change.after === undefined) meta.push("deleted file mode 100644");
  else meta.push("index 1111111..2222222 100644");
  meta.push(
    change.before === undefined ? "--- /dev/null" : `--- a/${change.renamedFrom ?? change.path}`,
  );
  meta.push(change.after === undefined ? "+++ /dev/null" : `+++ b/${change.path}`);
  const ops = diffOps(beforeLines, afterLines);
  const hunks = changeGroups(ops).map((group) => hunkText(ops, group));
  return [...meta, ...hunks].join("\n");
}

export function corpusDiffText(changes: FileChange[]): string {
  return changes.map(unifiedDiff).join("\n");
}
