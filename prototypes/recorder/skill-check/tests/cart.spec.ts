import { expect, test } from "@playwright/test";
import { LoginPage } from "../pages/LoginPage";

// Written from .ayme/recordings/rec_20261112T124115355Z/package.yaml by
// following skills/ayme-recorder/SKILL.md: interactions 1 to 8, in order.
test("adds the backpack to the cart and removes it there", async ({ page }) => {
  await page.goto("/");

  // interactions 1 to 5: fill the login form and submit it
  const loginPage = new LoginPage(page);
  await loginPage.fillLoginForm("standard_user", "secret_sauce");
  const inventoryPage = await loginPage.login();
  await expect(page).toHaveURL(/\/inventory\.html$/);
  await expect(inventoryPage.header.cartBadge).toBeHidden();

  // interaction 6: add the backpack to the cart
  let backpack;
  for (const item of await inventoryPage.items())
    if ((await item.name.innerText()) === "Sauce Labs Backpack")
      backpack = item;
  expect(backpack, "the backpack is listed").toBeDefined();
  await backpack!.addToCart();
  await expect(inventoryPage.header.cartBadge).toHaveText("1");
  await expect(backpack!.removeButton).toBeVisible();
  await expect(backpack!.addToCartButton).toBeHidden();

  // interaction 7: open the cart
  const cartPage = await inventoryPage.header.openCart();
  await expect(page).toHaveURL(/\/cart\.html$/);
  const cartItems = await cartPage.items();
  expect(cartItems).toHaveLength(1);
  await expect(cartItems[0].name).toHaveText("Sauce Labs Backpack");
  await expect(cartItems[0].quantity).toHaveText("1");

  // interaction 8: remove it
  await cartItems[0].remove();
  await expect(cartPage.itemRows).toHaveCount(0);
  await expect(cartPage.header.cartBadge).toBeHidden();
});
