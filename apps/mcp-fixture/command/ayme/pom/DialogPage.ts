import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

/**
 * The fixture's `dialogs.html`, present there alone. Each action clicks the
 * button that asks a confirm, then clicks Mark: one leaves the confirm to
 * whoever answers it, the other answers it itself.
 */
@ayme({
  present: (self: DialogPage) =>
    new URL(self.page.url()).pathname === "/dialogs.html",
})
export class DialogPage {
  constructor(readonly page: Page) {}

  @ayme.child
  get answer(): Locator {
    return this.page.locator("#answer");
  }

  @ayme.child
  get marks(): Locator {
    return this.page.locator("#marks");
  }

  @ayme.action({ description: "Remove Milk, then mark the page." })
  async removeThenMark() {
    await this.page.getByRole("button", { name: "Remove Milk" }).click();
    await this.page.getByRole("button", { name: "Mark" }).click();
  }

  @ayme.action({
    description:
      "Remove Milk, accepting the confirm itself, then mark the page.",
  })
  async removeAcceptingThenMark() {
    this.page.once("dialog", (dialog) => void dialog.accept());
    await this.page.getByRole("button", { name: "Remove Milk" }).click();
    await this.page.getByRole("button", { name: "Mark" }).click();
    return this.answer.textContent();
  }
}
