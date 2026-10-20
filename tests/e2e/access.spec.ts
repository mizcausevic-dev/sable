import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Sable-demo-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/app");
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
}

test("owner sees both Northline clients and can open the invoice balance", async ({ page }) => {
  await signIn(page, "mira.ellison@northline.test");
  await page.getByRole("link", { name: "Clients" }).click();
  await expect(page.getByRole("link", { name: "Bright Parcel" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kindred Press" })).toBeVisible();
  await page.goto("/app/revenue/invoices/11111111-1111-4111-8111-111111111701");
  await expect(page.getByText("USD 6,300.00").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Record a manual payment" })).toBeVisible();
});

test("assigned client sees the permitted project and not internal cost", async ({ page }) => {
  await signIn(page, "ava.quinn@brightparcel.test");
  await expect(page.getByRole("link", { name: "Revenue" })).toHaveCount(0);
  await page.getByRole("link", { name: "Clients" }).click();
  await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Bright Parcel" })).toBeVisible();
  await expect(page.getByText("Kindred Press")).toHaveCount(0);
  await page.goto("/app/clients/11111111-1111-4111-8111-111111111201");
  await expect(page.getByText("Kickoff is on the October calendar.")).toBeVisible();
  await expect(page.getByText("Rate card stays off the portal.")).toHaveCount(0);
  await page.goto("/app/projects/11111111-1111-4111-8111-111111111301");
  await expect(page.getByRole("heading", { name: "Parcel tracking refresh" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Internal budget" })).toHaveCount(0);
  await page.goto("/app/time");
  await expect(page.getByRole("heading", { name: "Permission denied" })).toBeVisible();
});

test("Harbor cannot see Northline clients", async ({ page }) => {
  await signIn(page, "owen.marsh@harbor.test");
  await page.getByRole("link", { name: "Clients" }).click();
  await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Lumen Market" })).toBeVisible();
  await expect(page.getByText("Bright Parcel")).toHaveCount(0);
  await page.goto("/app/clients/11111111-1111-4111-8111-111111111201");
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
});
