import type { On, Tab } from "../tab";

/**
 * The fixture page as the e2e suite reads it: a copy, on e2e's `screen`, of
 * the members of `pom/ListPage.ts` the suite uses. That class stays the
 * page's own Page Object, which the runtime registers.
 */
export class ListPage {
  constructor(private readonly tab: Tab) {}

  // fill_form's editor in the inline Inspector shows fields of the same
  // names, which e2e's screen reaches too, so the page's own are the ones in
  // main.
  get newItemInput(): On {
    return this.tab.on((screen) =>
      screen.getByRole("main").getByRole("textbox", "New item")
    );
  }

  get addItemButton(): On {
    return this.tab.on((screen) => screen.getByRole("button", "Add item"));
  }

  // The Inspector's Runs view has a "Clear" button too, so the page's own is
  // the one in main.
  get clearButton(): On {
    return this.tab.on((screen) =>
      screen.getByRole("main").getByRole("button", "Clear")
    );
  }

  /**
   * The pointer cursor over the New item field, as the page computes it. e2e
   * has no CSS matcher, so it is read with `getComputedStyle`.
   */
  async newItemInputCursor(): Promise<string> {
    await this.tab.front();
    return this.tab.browser.evaluate(
      () => getComputedStyle(document.querySelector("main label input")!).cursor
    );
  }

  get urgentCheckbox(): On {
    return this.tab.on((screen) =>
      screen.getByRole("main").getByRole("checkbox", "Urgent")
    );
  }

  async addItem(text: string) {
    await this.newItemInput.fill(text);
    await this.addItemButton.click();
  }

  /** Takes the Add item button off the page, so a tool that presses it fails. */
  async removeAddItemButton() {
    await this.tab.front();
    await this.tab.browser.evaluate(() => {
      [...document.querySelectorAll("main button")]
        .find((button) => button.textContent?.trim() === "Add item")
        ?.remove();
      return null;
    });
  }

  get items(): On {
    return this.tab.on((screen) =>
      screen.getByRole("list", "Items").getByRole("listitem")
    );
  }
}
