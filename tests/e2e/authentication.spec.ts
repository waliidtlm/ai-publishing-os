import { expect, test } from "@playwright/test";

test("development login protects the dashboard", async ({ page }) => {
  const email = process.env.DEV_AUTH_EMAIL;
  const password = process.env.DEV_AUTH_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "DEV_AUTH_EMAIL and DEV_AUTH_PASSWORD are required for the authentication test.",
    );
  }

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByText("Not production-secure.", { exact: true }),
  ).toBeVisible();

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("invalid-development-password");
  await page.getByRole("button", { name: "Sign in to development" }).click();
  await expect(
    page.getByText("Invalid development email or password.", { exact: true }),
  ).toBeVisible();

  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in to development" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: "Dashboard foundation" }),
  ).toBeVisible();
  await expect(page.getByText(email, { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});
