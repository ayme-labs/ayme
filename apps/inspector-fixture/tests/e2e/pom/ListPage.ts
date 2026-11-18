import type { On, Tab } from "../tab";

/**
 * The fixture page as the e2e suite reads it: a copy, on e2e's `screen`, of
 * the members of `pom/ListPage.ts` the suite uses. That class stays the
 * page's own Page Object, which the runtime registers.
 */
export class ListPage {
  constructor(private readonly tab: Tab) {}

  get newItemInput(): On {
    return this.tab.on((screen) => screen.getByRole("textbox", "New item"));
  }

  get addItemButton(): On {
    return this.tab.on((screen) => screen.getByRole("button", "Add item"));
  }

  get urgentCheckbox(): On {
    return this.tab.on((screen) => screen.getByRole("checkbox", "Urgent"));
  }

  get items(): On {
    return this.tab.on((screen) =>
      screen.getByRole("list", "Items").getByRole("listitem")
    );
  }
}
