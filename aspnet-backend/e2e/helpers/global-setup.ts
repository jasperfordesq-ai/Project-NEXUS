import { request } from "@playwright/test";
import { config as dotenvConfig } from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenvConfig({ path: path.resolve(__dirname, "../.env") });

// Use 127.0.0.1 to avoid IPv6 resolution issues with Docker on Windows
const API_URL = "http://127.0.0.1:5080";

const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL ?? "admin@acme.test",
  password: process.env["E2E_ADMIN_PASSWORD"] ?? "",
  tenant_slug: process.env.E2E_TENANT_SLUG ?? "acme",
};

const MEMBER = {
  email: process.env.E2E_MEMBER_EMAIL ?? "member@acme.test",
  password: process.env["E2E_MEMBER_PASSWORD"] ?? "",
  tenant_slug: process.env.E2E_TENANT_SLUG ?? "acme",
};

/**
 * Global setup runs once before all tests.
 * Fetches JWT tokens for admin and member users and saves them
 * to a temp file so test files can share them without hitting
 * the rate limiter multiple times.
 */
async function globalSetup() {
  const tokenFile = path.resolve(__dirname, "../.tokens.json");

  const ctx = await request.newContext({ baseURL: API_URL });

  const tokens: Record<string, string> = {};

  // Get admin token
  try {
    const adminRes = await ctx.post("/api/auth/login", {
      data: { email: ADMIN.email, password: ADMIN.password, tenant_slug: ADMIN.tenant_slug },
    });
    if (adminRes.status() === 200) {
      const body = await adminRes.json();
      tokens.admin = body.access_token ?? body.token ?? body.accessToken;
      console.log("[global-setup] Admin token obtained ✓");
    } else {
      console.warn(`[global-setup] Admin login failed: ${adminRes.status()}`);
    }
  } catch (e) {
    console.warn(`[global-setup] Admin login error: ${e}`);
  }

  // Get member token
  try {
    const memberRes = await ctx.post("/api/auth/login", {
      data: { email: MEMBER.email, password: MEMBER.password, tenant_slug: MEMBER.tenant_slug },
    });
    if (memberRes.status() === 200) {
      const body = await memberRes.json();
      tokens.member = body.access_token ?? body.token ?? body.accessToken;
      console.log("[global-setup] Member token obtained ✓");
    } else {
      console.warn(`[global-setup] Member login failed: ${memberRes.status()}`);
    }
  } catch (e) {
    console.warn(`[global-setup] Member login error: ${e}`);
  }

  await ctx.dispose();

  // Write tokens to temp file
  fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2));
  console.log(`[global-setup] Tokens saved to ${tokenFile}`);
}

export default globalSetup;
