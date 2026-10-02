import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

class MenuBase {
  readonly item!: Locator;
}

class UserMenu extends MenuBase {
  readonly signOutItem!: Locator;
}

@ayme
export class PageX {
  readonly heading!: Locator;
  readonly userMenu!: UserMenu;
}
