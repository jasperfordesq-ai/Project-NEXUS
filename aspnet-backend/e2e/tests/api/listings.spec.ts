import { test, expect, request } from "@playwright/test";
import { API_URL, getAdminToken, getMemberToken } from "../../helpers/auth";

test.describe("Listings API", () => {
  test("listings returns tenant-scoped array", async () => {
    const token = await getMemberToken();
    const ctx = await request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    const res = await ctx.get("/api/listings");
    expect(res.status()).toBe(200);
    const body = await res.json();
    const listings = Array.isArray(body) ? body : (body.data ?? body.listings ?? []);
    expect(Array.isArray(listings)).toBe(true);
    await ctx.dispose();
  });

  test("create and delete a listing", async () => {
    const token = await getMemberToken();
    const ctx = await request.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });

    const createRes = await ctx.post("/api/listings", {
      data: {
        title: "E2E Test Listing",
        description: "Created by Playwright",
        listing_type: "offer",
        time_credits: 1,
        category_id: 1,
      },
    });
    expect([200, 201]).toContain(createRes.status());
    const created = await createRes.json();
    const id = created.id ?? created.listing?.id;
    expect(id).toBeTruthy();

    // clean up
    const deleteRes = await ctx.delete(`/api/listings/${id}`);
    expect([200, 204]).toContain(deleteRes.status());

    await ctx.dispose();
  });
});
