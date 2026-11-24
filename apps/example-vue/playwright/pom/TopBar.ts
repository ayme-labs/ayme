import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";
import { AppPage } from "./AppPage";
import { CreateMenu } from "./CreateMenu";

/**
 * The top bar of the harness's dev-only create-menu page, which reproduces
 * issue 1059: its Create button says the menu is closed only through
 * `aria-expanded="false"`.
 */
export class TopBar extends AppPage {
  readonly path = "/harness/create-menu";
  @ayme.child
  readonly createMenu: CreateMenu;

  constructor(page: Page) {
    super(page);
    this.createMenu = new CreateMenu(
      page.getByRole("menu", { name: "Create" })
    );
  }

  @ayme.child
  get createButton(): Locator {
    return this.page.getByRole("button", { name: "Create" });
  }

  @ayme.action({ description: "Open the create menu." })
  async openCreateMenu(): Promise<CreateMenu> {
    await this.createButton.click();
    await this.createMenu.root.waitFor({ state: "visible" });
    return this.createMenu;
  }
}
