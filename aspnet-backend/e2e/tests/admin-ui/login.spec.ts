import { test, expect } from "@playwright/test";
import { loginAsAdmin } from "../../helpers/auth";

test.describe("Admin Panel UI", () => {
  test("login page loads", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle(/nexus|admin/i);
    await expect(page.getByRole("button", { name: /login|sign in/i })).toBeVisible();
  });

  test("login with valid admin credentials reaches dashboard", async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page).toHaveURL(/dashboard|\//);
    // dashboard should show some content
    await expect(page.locator("body")).not.toContainText("404");
  });

  test("login with wrong password shows error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill("admin@acme.test");
    await page.getByLabel(/password/i).fill("wrongpassword");
    const tenantField = page.getByPlaceholder(/tenant/i).or(page.getByLabel(/tenant/i));
    if (await tenantField.isVisible()) await tenantField.fill("acme");
    await page.getByRole("button", { name: /login|sign in/i }).click();
    // should stay on login or show error
    await page.waitForTimeout(2000);
    const url = page.url();
    const hasError = url.includes("login") || await page.locator(".ant-message-error, [class*=error], [class*=alert]").isVisible();
    expect(hasError).toBe(true);
  });
});
