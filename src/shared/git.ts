import type { GitDeps } from "./deps.ts";

export function gitResult(deps: GitDeps, root: string, args: string[]): string {
  const result = deps.git(args, root);
  if (result.exitCode !== 0)
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

export function resolveMergeBase(deps: GitDeps, root: string, base?: string): string {
  if (base) return gitResult(deps, root, ["merge-base", "HEAD", base]);
  for (const candidate of ["origin/main", "main"]) {
    const result = deps.git(["merge-base", "HEAD", candidate], root);
    if (result.exitCode === 0) return result.stdout.trim();
  }
  throw new Error("neither origin/main nor main is available");
}
