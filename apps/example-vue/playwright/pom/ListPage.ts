import { WebMCP } from "@ayme-dev/webmcp";
import type { Locator, Page } from "@playwright/test";
import { ArchiveDialog, ListItem } from "./components";

@WebMCP
export class ListPage {
  readonly newItemInput: Locator;
  readonly addItemButton: Locator;
  readonly archiveDialog: ArchiveDialog;
  private readonly itemRows: Locator;

  constructor(page: Page) {
    this.newItemInput = page.getByRole("textbox", { name: "New item" });
    this.addItemButton = page.getByRole("button", { name: "Add item" });
    this.archiveDialog = new ArchiveDialog(
      page.getByRole("dialog", { name: "Archive item" })
    );
    this.itemRows = page
      .getByRole("list", { name: "Active items" })
      .getByRole("listitem");
  }

  async items(): Promise<ListItem[]> {
    const rows = await this.itemRows.all();
    return rows.map((row) => new ListItem(row, this.archiveDialog));
  }

  @WebMCP.tool({
    description: "Add a new item to the list.",
  })
  async addItem(text: string) {
    await this.newItemInput.fill("");
    await this.newItemInput.pressSequentially(text, { delay: 60 });
    await this.addItemButton.click();
  }
}
