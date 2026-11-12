import { AppComponent, AppPage } from "./base";
import { Header } from "./Header";

export class CartPage extends AppPage {
  readonly header = new Header(this.page.getByRole("banner"));
  readonly cartList = this.page.getByTestId("cart-list");
  readonly itemRows = this.cartList.getByTestId("inventory-item");

  async items(): Promise<CartItem[]> {
    return (await this.itemRows.all()).map((item) => new CartItem(item));
  }
}

export class CartItem extends AppComponent {
  readonly name = this.root.getByTestId("inventory-item-name");
  readonly quantity = this.root.getByTestId("item-quantity");
  readonly removeButton = this.root.getByRole("button", { name: "Remove" });

  async remove() {
    await this.removeButton.click();
    await this.root.waitFor({ state: "detached" });
  }
}
