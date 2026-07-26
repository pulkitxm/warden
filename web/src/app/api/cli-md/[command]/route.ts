import { COMMANDS, commandBySlug } from "@/lib/docs";
import { absolute } from "@/lib/site";

export const dynamic = "force-static";

export function generateStaticParams() {
  return COMMANDS.map((command) => ({ command: command.name }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ command: string }> },
): Promise<Response> {
  const { command: name } = await params;
  const command = commandBySlug(name.replace(/\.md$/, ""));
  if (!command) return new Response("not found\n", { status: 404 });

  const usage = [
    "warden",
    command.name,
    command.positional?.kind,
    ...command.flags.map((flag) => `[${flag.name}${flag.valueHint ? ` ${flag.valueHint}` : ""}]`),
  ]
    .filter(Boolean)
    .join(" ");

  const flags = command.flags
    .map(
      (flag) =>
        `| \`${flag.name}${flag.valueHint ? ` ${flag.valueHint}` : ""}\` | ${flag.description} |`,
    )
    .join("\n");

  const values = command.positional?.values?.length
    ? `\n## Accepted values\n\n${command.positional.values.map((value) => `- \`${value}\``).join("\n")}\n`
    : "";

  const body = `# warden ${command.name}

> ${command.description}

Source: ${absolute(`/docs/cli/${command.name}`)}

## Usage

\`\`\`sh
${usage}
\`\`\`

## Flags

| Flag | Description |
| --- | --- |
${flags}
${values}
## Exit codes

${command.exitCodes}

## Example

\`\`\`sh
${command.example}
\`\`\`
`;

  return new Response(body, {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
}
