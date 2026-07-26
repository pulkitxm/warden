import { COMMANDS, commandBySlug } from "@/lib/docs";
import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from "@/lib/og";

export const alt = "Warden CLI reference";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return COMMANDS.map((command) => ({ command: command.name }));
}

export default async function Image({ params }: { params: Promise<{ command: string }> }) {
  const { command: name } = await params;
  const command = commandBySlug(name);
  return ogImage({
    label: "Docs · CLI",
    title: `warden ${command?.name ?? name}`,
    subtitle: command ? `${command.description} · ${command.example}` : undefined,
  });
}
