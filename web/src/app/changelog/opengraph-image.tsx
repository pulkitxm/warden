import { ogImage, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og";
import { META } from "./meta";

export const alt = META.title;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return ogImage({ label: META.label, title: META.title, subtitle: META.description });
}
