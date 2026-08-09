import { Page, request } from "@playwright/test";

// Credentials loaded from e2e/.env (see .env.example for required vars)
export const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? "admin@acme.test",
  password: process.env["E2E_ADMIN_PASSWORD"] ?? "",
  tenant_slug: process.env.E2E_TENANT_SLUG ?? "acme",
};

export const MEMBER = {
  email: process.env.E2E_MEMBER_EMAIL ?? "member@acme.test",
  password: process.env["E2E_MEMBER_PASSWORD"] ?? "",
  tenant_slug: process.env.E2E_TENANT_SLUG ?? "acme",
};

export const API_URL = "http://localhost:5080";

/** Login via the admin panel UI and return the page ready for further navigation. */
export async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(ADMIN.email);
  await page.getByLabel(/password/i).fill(ADMIN.password);
  // tenant slug field — look for placeholder or label
  const tenantField = page.getByPlaceholder(/tenant/i).or(page.getByLabel(/tenant/i));
  if (await tenantField.isVisible()) {
    await tenantField.fill(ADMIN.tenant_slug);
  }
  await page.getByRole("button", { name: /login|sign in/i }).click();
  await page.waitForURL(/dashboard|\/$/);
}

/** Obtain a JWT directly from the API (for API-level tests). */
export async function getAdminToken(): Promise<string> {
  const ctx = await request.newContext({ baseURL: API_URL });
  const res = await ctx.post("/api/auth/login", {
    data: { email: ADMIN.email, password: ADMIN.password, tenant_slug: ADMIN.tenant_slug },
  });
  const body = await res.json();
  await ctx.dispose();
  return body.access_token ?? body.token ?? body.accessToken;
}

export async function getMemberToken(): Promise<string> {
  const ctx = await request.newContext({ baseURL: API_URL });
  const res = await ctx.post("/api/auth/login", {
    data: { email: MEMBER.email, password: MEMBER.password, tenant_slug: MEMBER.tenant_slug },
  });
  const body = await res.json();
  await ctx.dispose();
  return body.access_token ?? body.token ?? body.accessToken;
}
