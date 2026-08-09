import { test, expect, request } from "@playwright/test";
import { API_URL, getAdminToken, getMemberToken } from "../../helpers/auth";

test.describe("Admin API", () => {
  test("admin dashboard returns metrics", async () => {
    const token = await getAdminToken();
    const ctx = await request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    const res = await ctx.get("/api/admin/dashboard");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("total_users");
    await ctx.dispose();
  });

  test("admin user list returns paginated results", async () => {
    const token = await getAdminToken();
    const ctx = await request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    const res = await ctx.get("/api/admin/users");
    expect(res.status()).toBe(200);
    const body = await res.json();
    // response may be array or { data: [], total }
    const users = Array.isArray(body) ? body : (body.data ?? body.users ?? []);
    expect(Array.isArray(users)).toBe(true);
    await ctx.dispose();
  });

  test("member cannot access admin endpoints", async () => {
    const token = await getMemberToken();
    const ctx = await request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    const res = await ctx.get("/api/admin/dashboard");
    expect([401, 403]).toContain(res.status());
    await ctx.dispose();
  });

  test("admin sessions endpoint returns session list", async () => {
    const token = await getAdminToken();
    const ctx = await request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    const res = await ctx.get("/api/admin/sessions");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
    await ctx.dispose();
  });

  test("admin saved-searches endpoint returns list", async () => {
    const token = await getAdminToken();
    const ctx = await request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    const res = await ctx.get("/api/admin/saved-searches");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("data");
    await ctx.dispose();
  });

  test("admin sub-accounts endpoint returns list", async () => {
    const token = await getAdminToken();
    const ctx = await request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    const res = await ctx.get("/api/admin/sub-accounts");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("data");
    await ctx.dispose();
  });
});
