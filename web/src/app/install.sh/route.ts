import { readFileSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-static";

export function GET(): Response {
  const script = readFileSync(join(process.cwd(), "..", "install.sh"), "utf8");
  return new Response(script, {
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
}
