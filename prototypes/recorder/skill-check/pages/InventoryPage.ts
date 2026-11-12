import { AppComponent, AppPage } from "./base";
import { Header } from "./Header";

export class InventoryPage extends AppPage {
  readonly header = new Header(this.page.getByRole("banner"));
  readonly inventoryList = this.page.getByTestId("inventory-list");

  async items(): Promise<InventoryItem[]> {
    return (await this.inventoryList.getByTestId("inventory-item").all()).map(
      (item) => new InventoryItem(item)
    );
  }
}

export class InventoryItem extends AppComponent {
  readonly name = this.root.getByTestId("inventory-item-name");
  readonly addToCartButton = this.root.getByRole("button", {
    name: "Add to cart",
  });
  readonly removeButton = this.root.getByRole("button", { name: "Remove" });

  async addToCart() {
    await this.addToCartButton.click();
    await this.removeButton.waitFor();
    return this;
  }
}
