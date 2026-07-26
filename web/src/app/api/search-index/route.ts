import { SEARCH_INDEX } from "@/lib/search-index";

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(
    JSON.stringify({ version: 1, count: SEARCH_INDEX.length, records: SEARCH_INDEX }),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=600, s-maxage=86400, stale-while-revalidate=604800",
      },
    },
  );
}
