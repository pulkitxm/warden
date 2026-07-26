import { DOC_PAGES, docBySlug } from "@/lib/docs";
import { OG_CONTENT_TYPE, OG_SIZE, ogImage } from "@/lib/og";

export const alt = "Warden documentation";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export function generateStaticParams() {
  return DOC_PAGES.map((page) => ({ slug: page.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = docBySlug(slug);
  return ogImage({
    label: `Docs · ${page?.section ?? "Reference"}`,
    title: page?.title ?? "Documentation",
    subtitle: page?.description,
  });
}
