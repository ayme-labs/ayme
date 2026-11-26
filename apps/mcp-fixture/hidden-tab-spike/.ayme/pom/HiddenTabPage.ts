import { ayme } from "@ayme-dev/ayme";
import { expect, type Locator, type Page } from "@playwright/test";

/** Spike: the panel the page shows a moment after it is asked to. */
@ayme({
  root: (self: PanelPage) => self.panel,
  present: (self: PanelPage) => self.panel.isVisible(),
})
export class PanelPage {
  readonly panel: Locator;

  constructor(readonly page: Page) {
    this.panel = page.locator("#panel");
  }
}

/**
 * Spike: the hidden tab test page. `hideThen` hides its own Tab one way,
 * then takes one kind of step, so each part of a Run can be timed on a
 * hidden Tab.
 */
@ayme
export class HiddenTabPage {
  @ayme.child
  readonly result: Locator;

  @ayme.child
  readonly marks: Locator;

  readonly popupButton: Locator;
  readonly newTabLink: Locator;
  readonly markButton: Locator;
  readonly resetButton: Locator;
  readonly name: Locator;

  constructor(readonly page: Page) {
    this.result = page.locator("#result");
    this.marks = page.locator("#marks");
    this.popupButton = page.locator("#popup");
    this.newTabLink = page.locator("#newtab");
    this.markButton = page.locator("#mark");
    this.resetButton = page.locator("#reset");
    this.name = page.locator("#name");
  }

  @ayme.action({
    description:
      "Hide the Tab (popup: open a popup window; tab: open a link in a new tab; wait: wait 1.5 s for someone else to hide it; none), then take one step.",
  })
  async hideThen(
    hide: "none" | "popup" | "tab" | "wait",
    step:
      | "none"
      | "click"
      | "fill"
      | "press"
      | "expect"
      | "timeout"
      | "panel"
      | "churn"
      | "clickfill"
      | "movingclickfill"
  ): Promise<PanelPage | undefined> {
    if (hide === "popup") await this.popupButton.click();
    if (hide === "tab") await this.newTabLink.click();
    if (hide === "wait") await this.page.waitForTimeout(1500);
    if (step === "click") await this.markButton.click();
    if (step === "fill") await this.name.fill("Ada Lovelace");
    if (step === "movingclickfill") {
      // The button moves for 2 s, so the click waits for it to stand still.
      await this.page.evaluate(() =>
        (window as never as { moveFor(ms: number): void }).moveFor(2000)
      );
      await this.markButton.click();
      await this.name.fill("after the click");
    }
    if (step === "clickfill") {
      await this.markButton.click();
      await this.name.fill("after the click");
    }
    if (step === "press")
      await this.name.pressSequentially("Ada", { delay: 30 });
    if (step === "expect") {
      await this.page.evaluate(() =>
        (window as never as { later(ms: number): void }).later(300)
      );
      await expect(this.result).toHaveText("result: done");
    }
    if (step === "timeout") await this.page.waitForTimeout(500);
    if (step === "churn")
      await this.page.evaluate(() =>
        (
          window as never as { churnFor(ms: number, every: number): void }
        ).churnFor(1500, 100)
      );
    if (step === "panel") {
      await this.page.evaluate(() =>
        (window as never as { panelLater(ms: number): void }).panelLater(300)
      );
      return new PanelPage(this.page);
    }
    return undefined;
  }

  @ayme.action({ description: "Click Mark once." })
  async mark() {
    await this.markButton.click();
  }

  @ayme.action({ description: "Reset the page." })
  async reset() {
    await this.resetButton.click();
  }
}
