import { notFound } from "next/navigation";
import { Prose } from "@/components/chrome";
import { DocsPage } from "@/components/docs-page";
import { DOC_PAGES, docBySlug } from "@/lib/docs";
import { headingsOf, renderMarkdown } from "@/lib/markdown";
import { breadcrumbs, JsonLd, pageMetadata, techArticle } from "@/lib/seo";

export function generateStaticParams() {
  return DOC_PAGES.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = docBySlug(slug);
  if (!page) return {};
  return pageMetadata({
    title: page.title,
    description: page.description,
    path: `/docs/${page.slug}`,
    type: "article",
  });
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = docBySlug(slug);
  if (!page) notFound();

  const path = `/docs/${page.slug}`;
  const trail = [
    { name: "Home", path: "/" },
    { name: "Docs", path: "/docs" },
    { name: page.title, path },
  ];
  const html = await renderMarkdown(page.body);
  const index = DOC_PAGES.findIndex((entry) => entry.slug === page.slug);
  const previous = DOC_PAGES[index - 1];
  const next = DOC_PAGES[index + 1];

  return (
    <>
      <JsonLd
        data={[
          techArticle({ title: page.title, description: page.description, path }),
          breadcrumbs(trail),
        ]}
      />
      <DocsPage
        trail={trail}
        eyebrow={page.section}
        title={page.title}
        description={page.description}
        toc={headingsOf(page.body)}
        markdownPath={`/docs/${page.slug}.md`}
        previous={previous ? { href: `/docs/${previous.slug}`, label: previous.title } : undefined}
        next={next ? { href: `/docs/${next.slug}`, label: next.title } : undefined}
        related={page.related?.map((relatedSlug) => {
          const related = docBySlug(relatedSlug);
          return {
            href: related ? `/docs/${related.slug}` : "/docs/cli",
            label: related ? related.title : "CLI reference",
            description: related?.description,
          };
        })}
      >
        <Prose html={html} />
      </DocsPage>
    </>
  );
}
