import axios from "axios";
import { baseUrl, maxRate } from "./config.ts";

const client = axios.create({ baseURL: baseUrl });

let stamps: number[] = [];

function underRateLimit(): boolean {
  const now = Date.now();
  stamps = stamps.filter((stamp) => now - stamp < 1000);
  return stamps.length < maxRate;
}

async function waitForRateLimitSlot(): Promise<void> {
  while (!underRateLimit()) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  stamps.push(Date.now());
}

export function backoffDelay(attempt: number): number {
  return Math.min(30_000, 2 ** attempt * 250);
}

export async function fetchJson(url: string): Promise<unknown> {
  await waitForRateLimitSlot();
  client.throttle({ rate: maxRate });
  let attempt = 0;
  for (;;) {
    const res = await client.get(url, { validateStatus: () => true });
    if (res.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, backoffDelay(attempt)));
      attempt += 1;
      continue;
    }
    if (res.data == null || res.data === "") return {};
    return res.data;
  }
}
