import { DOC_PAGES, docBySlug } from "@/lib/docs";
import { absolute } from "@/lib/site";

export const dynamic = "force-static";

export function generateStaticParams() {
  return DOC_PAGES.map((page) => ({ slug: page.slug }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const page = docBySlug(slug.replace(/\.md$/, ""));
  if (!page) return new Response("not found\n", { status: 404 });

  const body = `# ${page.title}

> ${page.description}

Source: ${absolute(`/docs/${page.slug}`)}
${page.body}`;

  return new Response(body, {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
}
