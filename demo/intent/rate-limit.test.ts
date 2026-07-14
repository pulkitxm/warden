import { expect, test } from "bun:test";
import { backoffDelay } from "./api-client.ts";

test("429 backoff grows exponentially and caps at thirty seconds", () => {
  expect(backoffDelay(0)).toBe(250);
  expect(backoffDelay(1)).toBe(500);
  expect(backoffDelay(2)).toBe(1000);
  expect(backoffDelay(20)).toBe(30_000);
});
