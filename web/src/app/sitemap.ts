import type { MetadataRoute } from "next";
import { COMMANDS, DOC_PAGES } from "@/lib/docs";
import { absolute } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticPaths = [
    { path: "/", priority: 1 },
    { path: "/docs", priority: 0.9 },
    { path: "/docs/cli", priority: 0.9 },
    { path: "/install", priority: 0.9 },
    { path: "/hack", priority: 0.7 },
    { path: "/about", priority: 0.6 },
    { path: "/contact", priority: 0.5 },
    { path: "/changelog", priority: 0.5 },
  ];
  return [
    ...staticPaths.map((entry) => ({
      url: absolute(entry.path),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: entry.priority,
    })),
    ...DOC_PAGES.map((page) => ({
      url: absolute(`/docs/${page.slug}`),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...COMMANDS.map((command) => ({
      url: absolute(`/docs/cli/${command.name}`),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
  ];
}
