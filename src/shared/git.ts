import type { WardenDeps } from "./deps.ts";

export function gitResult(deps: WardenDeps, root: string, args: string[]): string {
  const result = deps.git(args, root);
  if (result.exitCode !== 0)
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

export function resolveMergeBase(deps: WardenDeps, root: string, base?: string): string {
  if (base) return gitResult(deps, root, ["merge-base", "HEAD", base]);
  for (const candidate of ["origin/main", "main"]) {
    const result = deps.git(["merge-base", "HEAD", candidate], root);
    if (result.exitCode === 0) return result.stdout.trim();
  }
  throw new Error("neither origin/main nor main is available");
}
