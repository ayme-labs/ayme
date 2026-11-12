import { Page, Locator } from '@playwright/test';
export abstract class AppPage { constructor(readonly page: Page) {} }
export abstract class AppComponent { constructor(readonly root: Locator) {} }
export class Header extends AppComponent {
  readonly cart = this.root.getByTestId('shopping-cart-link');
  readonly badge = this.root.getByTestId('shopping-cart-badge');
  async openCart() { await this.cart.click(); const result = new CartPage(this.root.page()); await result.title.waitFor(); return result; }
}
export class Product extends AppComponent {
  readonly name = this.root.getByTestId('inventory-item-name');
  readonly add = this.root.getByTestId('add-to-cart-sauce-labs-backpack');
}
export class CartItem extends AppComponent {
  readonly name = this.root.getByTestId('inventory-item-name');
  readonly remove = this.root.getByTestId('remove-sauce-labs-backpack');
}
export class InventoryPage extends AppPage {
  readonly title = this.page.getByTestId('title');
  readonly header = new Header(this.page.getByTestId('header-container'));
  async products() { return (await this.page.getByTestId('inventory-item').all()).map(root => new Product(root)); }
}
export class CartPage extends AppPage {
  readonly title = this.page.getByTestId('title');
  readonly header = new Header(this.page.getByTestId('header-container'));
  async items() { return (await this.page.getByTestId('inventory-item').all()).map(root => new CartItem(root)); }
}
export class LoginPage extends AppPage {
  readonly username = this.page.getByTestId('username');
  readonly password = this.page.getByTestId('password');
  readonly submit = this.page.getByTestId('login-button');
  readonly error = this.page.getByTestId('error');
  async login() {
    await this.submit.click();
    const inventory = new InventoryPage(this.page);
    await inventory.title.or(this.error).waitFor();
    return await this.error.isVisible() ? this : inventory;
  }
}
