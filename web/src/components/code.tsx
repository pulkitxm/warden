import { codeToHtml } from "shiki";
import { SHIKI_THEME } from "@/lib/markdown";

export async function CodeBlock({
  code,
  lang = "bash",
  className = "",
}: {
  code: string;
  lang?: string;
  className?: string;
}) {
  const html = await codeToHtml(code, { lang, theme: SHIKI_THEME });
  return (
    <div
      className={`shiki-block overflow-x-auto rounded-xl border border-white/12 ${className}`}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: highlighted output from trusted in-repo source
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
