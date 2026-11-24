import { ayme } from "@ayme-dev/ayme";
import type { Locator } from "@playwright/test";
import { AppComponent } from "./AppComponent";

/** The menu the top bar's Create button opens, on the harness's dev-only
 *  create-menu page. */
export class CreateMenu extends AppComponent {
  constructor(root: Locator) {
    super(root);
  }

  @ayme.child
  get newDocumentItem(): Locator {
    return this.root.getByRole("menuitem", { name: "New document" });
  }

  @ayme.child
  get newFolderItem(): Locator {
    return this.root.getByRole("menuitem", { name: "New folder" });
  }
}
