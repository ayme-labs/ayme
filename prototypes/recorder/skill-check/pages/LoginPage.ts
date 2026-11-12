import { AppPage } from "./base";
import { InventoryPage } from "./InventoryPage";

export class LoginPage extends AppPage {
  readonly usernameInput = this.page.getByTestId("username");
  readonly passwordInput = this.page.getByTestId("password");
  readonly loginButton = this.page.getByTestId("login-button");

  async fillLoginForm(username: string, password: string) {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    return this;
  }

  // The recording shows one outcome: the inventory page opens.
  async login() {
    await this.loginButton.click();
    const inventoryPage = new InventoryPage(this.page);
    await inventoryPage.inventoryList.waitFor();
    return inventoryPage;
  }
}
