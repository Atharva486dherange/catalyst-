import { expect, test } from "@playwright/test";
import { apiContracts } from "../../shared/contracts/api";

test("GET /api/v1/health serves a public health check", async ({ request }) => {
  const response = await request.get("/api/v1/health");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(apiContracts.health.response.parse(await response.json())).toEqual({ data: { status: "ok" } });
});
