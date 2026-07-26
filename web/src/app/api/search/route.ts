import { prepare, search } from "@/lib/search";
import { SEARCH_INDEX } from "@/lib/search-index";

export const dynamic = "force-dynamic";

const ENTRIES = prepare(SEARCH_INDEX);
const MAX_QUERY = 120;
const MAX_LIMIT = 25;
const DEFAULT_LIMIT = 10;

export function GET(request: Request): Response {
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").slice(0, MAX_QUERY);
  const requested = Number.parseInt(params.get("limit") ?? "", 10);
  const limit = Math.min(
    Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_LIMIT,
    MAX_LIMIT,
  );
  const results = search(ENTRIES, query, limit);

  return new Response(JSON.stringify({ query, count: results.length, results }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
