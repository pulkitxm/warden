export function rewriteArgv(argv: string[], command: string, stripVerbs: string[] = []): string[] {
  const rest = [...argv];
  if (stripVerbs.includes(rest[0] ?? "")) rest.shift();
  return [command, ...rest];
}
