import type { Locator } from "@playwright/test";
import { AppComponent } from "./AppComponent";

/** The menu the top bar's Create button opens, on the harness's dev-only
 *  create-menu page. */
export class CreateMenu extends AppComponent {
  readonly newDocumentItem: Locator;
  readonly newFolderItem: Locator;

  constructor(root: Locator) {
    super(root);
    this.newDocumentItem = root.getByRole("menuitem", { name: "New document" });
    this.newFolderItem = root.getByRole("menuitem", { name: "New folder" });
  }
}
