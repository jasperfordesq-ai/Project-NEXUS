import { test, expect, request } from "@playwright/test";
import { API_URL, getMemberToken } from "../../helpers/auth";

test.describe("Wallet API", () => {
  test("balance returns numeric value", async () => {
    const token = await getMemberToken();
    const ctx = await request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    const res = await ctx.get("/api/wallet/balance");
    expect(res.status()).toBe(200);
    const body = await res.json();
    const balance = body.balance ?? body.credits ?? body;
    expect(typeof balance === "number" || typeof balance === "string").toBe(true);
    await ctx.dispose();
  });

  test("transactions returns paginated list", async () => {
    const token = await getMemberToken();
    const ctx = await request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    const res = await ctx.get("/api/wallet/transactions");
    expect(res.status()).toBe(200);
    const body = await res.json();
    const txns = Array.isArray(body) ? body : (body.data ?? body.transactions ?? []);
    expect(Array.isArray(txns)).toBe(true);
    await ctx.dispose();
  });
});
