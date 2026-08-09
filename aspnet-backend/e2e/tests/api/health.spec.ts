import { test, expect, request } from "@playwright/test";
import { API_URL } from "../../helpers/auth";

test.describe("Health & Infrastructure", () => {
  // /health runs ALL checks including LlamaHealthCheck (Ollama). If Ollama is not
  // running the endpoint returns 503 Degraded — still a valid "API is up" response.
  // We accept 200 (all healthy) or 503 (degraded) and verify the JSON shape.
  test("health endpoint responds with status JSON", async () => {
    const ctx = await request.newContext({ baseURL: API_URL });
    const res = await ctx.get("/health", { timeout: 60_000 });
    expect([200, 503]).toContain(res.status());
    const body = await res.json();
    expect(body).toHaveProperty("status");
    expect(["Healthy", "Degraded", "Unhealthy"]).toContain(body.status);
    await ctx.dispose();
  });

  test("swagger UI is available", async () => {
    const ctx = await request.newContext({ baseURL: API_URL });
    // /swagger redirects to /swagger/index.html — hit it directly
    const res = await ctx.get("/swagger/index.html");
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text.toLowerCase()).toContain("swagger");
    await ctx.dispose();
  });

  test("unauthenticated login endpoint is reachable", async () => {
    const ctx = await request.newContext({ baseURL: API_URL });
    // POST with no body → 400 Bad Request (not 404 or 500)
    const res = await ctx.post("/api/auth/login", { data: {} });
    expect([400, 401, 422]).toContain(res.status());
    await ctx.dispose();
  });
});
