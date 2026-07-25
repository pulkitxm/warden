import { ogImage, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og";

export const alt = "Warden CLI reference";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage({
    label: "Docs · CLI",
    title: "CLI reference",
    subtitle: "Every verb, flag, and exit code, generated from the command registry.",
  });
}
