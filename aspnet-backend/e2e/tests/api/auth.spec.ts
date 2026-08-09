import { test, expect, request } from "@playwright/test";
import { ADMIN, MEMBER, API_URL, getAdminToken } from "../../helpers/auth";

test.describe("Auth API", () => {
  test("login with valid admin credentials returns token", async () => {
    const ctx = await request.newContext({ baseURL: API_URL });
    const res = await ctx.post("/api/auth/login", {
      data: { email: ADMIN.email, password: ADMIN.password, tenant_slug: ADMIN.tenant_slug },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.access_token ?? body.token ?? body.accessToken).toBeTruthy();
    await ctx.dispose();
  });

  test("login with wrong password returns 401", async () => {
    const ctx = await request.newContext({ baseURL: API_URL });
    const res = await ctx.post("/api/auth/login", {
      data: { email: ADMIN.email, password: process.env["E2E_WRONG_PASSWORD"] ?? "bad-creds", tenant_slug: ADMIN.tenant_slug },
    });
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test("login with member credentials returns token", async () => {
    const ctx = await request.newContext({ baseURL: API_URL });
    const res = await ctx.post("/api/auth/login", {
      data: { email: MEMBER.email, password: MEMBER.password, tenant_slug: MEMBER.tenant_slug },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.access_token ?? body.token ?? body.accessToken).toBeTruthy();
    await ctx.dispose();
  });

  test("validate endpoint accepts valid token", async () => {
    const token = await getAdminToken();
    const ctx = await request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    const res = await ctx.get("/api/auth/validate");
    expect(res.status()).toBe(200);
    await ctx.dispose();
  });

  test("protected endpoint rejects request without token", async () => {
    const ctx = await request.newContext({ baseURL: API_URL });
    const res = await ctx.get("/api/users/me");
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });
});
