import rehypeShiki from "@shikijs/rehype";
import type { ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import rehypeExternalLinks from "rehype-external-links";
import rehypeReact from "rehype-react";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { ProseLink } from "@/components/prose-link";
import { rehypeCodeWrap } from "./rehype-code-wrap";
import { rehypeTerminal } from "./rehype-terminal";
import { slugify } from "./slug";

export { slugify };

export const SHIKI_THEME = "github-dark-default";

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeTerminal)
  .use(rehypeSlug)
  .use(rehypeExternalLinks, { target: "_blank", rel: ["noreferrer"] })
  .use(rehypeShiki, { theme: SHIKI_THEME })
  .use(rehypeCodeWrap)
  .use(rehypeReact, { Fragment, jsx, jsxs, components: { a: ProseLink } });

export async function renderMarkdown(body: string): Promise<ReactNode> {
  const file = await processor.process(body);
  return file.result;
}

export function headingsOf(body: string): Array<{ id: string; text: string }> {
  return body
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => {
      const text = line.slice(3).trim().replace(/`/g, "");
      return { id: slugify(text), text };
    });
}
