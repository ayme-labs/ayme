import { AppComponent } from "./base";
import { CartPage } from "./CartPage";

/** The banner every visit repeats. */
export class Header extends AppComponent {
  readonly cartLink = this.root.getByTestId("shopping-cart-link");
  readonly cartBadge = this.root.getByTestId("shopping-cart-badge");

  async openCart() {
    await this.cartLink.click();
    const cartPage = new CartPage(this.root.page());
    await cartPage.cartList.waitFor();
    return cartPage;
  }
}
