import { expect, test } from "@playwright/test";
import { apiContracts } from "../../shared/contracts/api";

test("GET /api/v1/health serves a public health check", async ({ request }) => {
  const response = await request.get("/api/v1/health");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(apiContracts.health.response.parse(await response.json())).toEqual({ data: { status: "ok" } });
});

test("the sample preview is served as HTML and links back to the connected app", async ({ request }) => {
  const preview = await request.get("/saathi_hackathon_ui.html");
  expect(preview.status()).toBe(200);
  expect(preview.headers()["content-type"]).toContain("text/html");
  expect(await preview.text()).toContain('id="connectedApp" href="/"');
  expect((await request.get("/")).status()).toBe(200);
});
