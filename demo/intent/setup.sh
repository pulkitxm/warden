#!/bin/sh
# Builds the intent demo repo: a base commit plus seeded working-tree changes
# containing one dropped requirement, one scope-creep rewrite, and one
# hallucinated axios API. Run: sh demo/intent/setup.sh [target-dir]
set -e

demo_dir="${1:-/tmp/warden-intent-demo}"
here="$(cd "$(dirname "$0")" && pwd)"

rm -rf "$demo_dir"
mkdir -p "$demo_dir"
cd "$demo_dir"
git init -q
git checkout -qb main 2>/dev/null || true

# --- base versions (committed) ---
cat > config.ts <<'EOF'
export const baseUrl = "https://api.example.com";
EOF

cat > api-client.ts <<'EOF'
import axios from "axios";
import { baseUrl } from "./config.ts";

const client = axios.create({ baseURL: baseUrl });

export async function fetchJson(url: string): Promise<unknown> {
  const res = await client.get(url);
  return res.data;
}
EOF

cat > pagination.ts <<'EOF'
export function paginate<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages;
}
EOF

cp "$here/retry.ts" retry.ts

git add .
git -c user.email=demo@warden.dev -c user.name=warden-demo commit -qm "base api client"

# --- seeded agent changes (uncommitted working tree) ---
cp "$here/api-client.ts" api-client.ts
cp "$here/pagination.ts" pagination.ts
cp "$here/config.ts" config.ts
cp "$here/rate-limit.demo.ts" rate-limit.demo.ts

mkdir -p .warden
cp "$here/prompt.txt" .warden/prompt.txt

# axios gives the micro-test a runnable import and lets the node_modules
# extractor answer for real packages a judge names
bun add axios >/dev/null 2>&1 || echo "note: bun add axios failed; micro-test needs it"

echo "demo repo ready at $demo_dir"
echo "next:"
echo "  cd $demo_dir"
echo "  warden intent check          # prompt comes from .warden/prompt.txt"
echo "  warden intent symbols        # just the hallucination proof"
echo "  bun test ./rate-limit.demo.ts  # pre-baked micro-test"
