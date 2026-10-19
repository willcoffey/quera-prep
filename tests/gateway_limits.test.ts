import { describe, expect, test } from "vitest";
/**
 * Limits from compose.yaml kong configuration
 * as of Oct 19 2026
 */
const CONFIGURED_LIMITS = {
  maxPayload: 128 * 1024,
  bucketSize: 50,
  refillRate: 10,
};
const BASE_URL = "http://localhost:8000";

describe("gateway_limits", () => {
  test("413 - body over 128k", testPayload());
  test("429 - burst over limit", testBurst(), 20_000);
});

/**
 * Send a very large body to the gateway, should error without ever getting
 * past kong/nginx. never parsed by TaskManager
 */
function testPayload() {
  return async () => {
    const body = "x".repeat(CONFIGURED_LIMITS.maxPayload + 1);
    const res = await fetch(`${BASE_URL}/tasks/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(res.status).toBe(413);
  };
}

/**
 * Send a burst of requests, 2x the bucket size, to the kong gateway. Requests
 * are simply loads of the root with a random url param to prevent cacheing.
 */
function testBurst() {
  return async () => {
    const { bucketSize, refillRate } = CONFIGURED_LIMITS;
    // Ensure that the bucket is full before starting the test
    await sleep((bucketSize / refillRate) * 1000 + 1000);

    // Unique query per request so a cache can't answer for kong
    const requests: Promise<Response>[] = [];
    for (let i = 0; i < bucketSize * 2; i++) {
      requests.push(fetch(`${BASE_URL}/?n=${crypto.randomUUID()}`));
    }
    const responses = await Promise.all(requests);
    const statuses = responses.map((res) => res.status);

    const ok = statuses.filter((s) => s === 200).length;
    const limited = statuses.filter((s) => s === 429).length;

    expect(ok + limited, `unexpected statuses ${statuses}`).toBe(statuses.length);

    // The bucket gets through, plus a few that refill while it's sent
    expect(ok).toBeGreaterThanOrEqual(bucketSize);
    expect(ok).toBeLessThan(bucketSize + refillRate);
    await sleep((bucketSize / refillRate) * 1000 + 1000);
    const res = await fetch(`${BASE_URL}/?n=` + crypto.randomUUID());

    expect(res.status).toBe(200);
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
