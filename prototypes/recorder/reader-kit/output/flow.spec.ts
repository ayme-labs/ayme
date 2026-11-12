import { test, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { LoginPage, InventoryPage } from './pages';
test('recorded backpack cart flow', async ({ page }) => {
  await page.goto('/');
  const login = new LoginPage(page);
  await login.username.click();
  await login.username.fill('standard_user');
  await login.password.click();
  await login.password.fill('secret_sauce');
  const inventory = await login.login();
  assert(inventory instanceof InventoryPage);
  await expect(inventory.title).toHaveText('Products');
  const products = await inventory.products();
  const backpack = (await Promise.all(products.map(async product => ({ product, name: await product.name.innerText() }))))
    .find(item => item.name === 'Sauce Labs Backpack')!.product;
  await backpack.add.click();
  await expect(inventory.header.badge).toHaveText('1');
  const cart = await inventory.header.openCart();
  await expect(cart.title).toHaveText('Your Cart');
  const items = await cart.items();
  expect(items).toHaveLength(1);
  await expect(items[0].name).toHaveText('Sauce Labs Backpack');
  await items[0].remove.click();
  await expect(items[0].root).toHaveCount(0);
  await expect(cart.header.badge).toHaveCount(0);
  await expect(cart.header.cart).toBeVisible();
});
