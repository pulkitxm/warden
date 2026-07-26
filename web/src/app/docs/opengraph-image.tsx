import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from "@/lib/og";

export const alt = "Warden documentation";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage({
    label: "Docs",
    title: "Documentation",
    subtitle: "Concepts, CLI reference, doctor, intent, CI, agents, and the threat model.",
  });
}
