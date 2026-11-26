import { ayme } from "@ayme-dev/ayme";
import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Spike: the dialog test page. Each action opens a dialog with one click,
 * then takes a step that visibly changes the page (`marks` goes up), so a
 * leftover step that ran shows.
 */
@ayme
export class DialogPage {
  @ayme.child
  readonly result: Locator;

  @ayme.child
  readonly marks: Locator;

  readonly confirmButton: Locator;
  readonly alertButton: Locator;
  readonly promptButton: Locator;
  readonly markButton: Locator;
  readonly resetButton: Locator;

  constructor(readonly page: Page) {
    this.result = page.locator("#result");
    this.marks = page.locator("#marks");
    this.confirmButton = page.locator("#confirm");
    this.alertButton = page.locator("#alert");
    this.promptButton = page.locator("#prompt");
    this.markButton = page.locator("#mark");
    this.resetButton = page.locator("#reset");
  }

  @ayme.action({ description: "Open a confirm, then click Mark." })
  async confirmThenMark() {
    await this.confirmButton.click();
    await this.markButton.click();
  }

  @ayme.action({
    description: "Open a confirm, expect its result, then click Mark.",
  })
  async confirmThenExpect() {
    await this.confirmButton.click();
    await expect(this.result).toHaveText(/result: confirm/);
    await this.markButton.click();
  }

  @ayme.action({
    description: "Accept the confirm it opens itself, then click Mark.",
  })
  async confirmOwnAnswer() {
    this.page.once("dialog", (dialog) => void dialog.accept());
    await this.confirmButton.click();
    await this.markButton.click();
  }

  @ayme.action({ description: "Open an alert, then click Mark." })
  async alertThenMark() {
    await this.alertButton.click();
    await this.markButton.click();
  }

  @ayme.action({
    description: "Accept the alert it opens itself, then click Mark.",
  })
  async alertOwnAnswer() {
    this.page.once("dialog", (dialog) => void dialog.accept());
    await this.alertButton.click();
    await this.markButton.click();
  }

  @ayme.action({
    description:
      "Accept the alert it opens itself, returning accept's promise, then click Mark.",
  })
  async alertOwnAnswerReturning() {
    this.page.once("dialog", (dialog) => dialog.accept());
    await this.alertButton.click();
    await this.markButton.click();
  }

  @ayme.action({ description: "Open a prompt, then click Mark." })
  async promptThenMark() {
    await this.promptButton.click();
    await this.markButton.click();
  }

  @ayme.action({
    description: "Open a confirm and click Mark inside one page evaluation.",
  })
  async confirmInOneEvaluate() {
    await this.page.evaluate(() => {
      document.querySelector<HTMLElement>("#confirm")!.click();
      document.querySelector<HTMLElement>("#mark")!.click();
    });
  }

  @ayme.action({
    description:
      "Open a confirm, and start a Mark click without waiting for the first.",
  })
  async confirmAndMarkTogether() {
    await Promise.all([this.confirmButton.click(), this.markButton.click()]);
  }

  @ayme.action({
    description: "Open a confirm, wait three seconds, then click Mark.",
  })
  async confirmThenWaitThenMark() {
    await this.confirmButton.click();
    await this.page.waitForTimeout(3000);
    await this.markButton.click();
  }

  @ayme.action({
    description:
      "Add a listener that accepts the next dialog, and open none: a listener left behind.",
  })
  async armOwnAnswerOnly() {
    this.page.once("dialog", (dialog) => dialog.accept());
    await this.markButton.click();
  }

  @ayme.action({ description: "Click Mark once." })
  async mark() {
    await this.markButton.click();
  }

  @ayme.action({ description: "Reset the page's result and marks." })
  async reset() {
    await this.resetButton.click();
  }
}
