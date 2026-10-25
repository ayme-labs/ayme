import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme({ root: (self: BaseMenu) => self.item })
class BaseMenu {
  readonly item!: Locator;
}

class UserMenu extends BaseMenu {
  readonly signOutItem!: Locator;
}

@ayme
export class PageY {
  readonly heading!: Locator;
  readonly userMenu!: UserMenu;
  readonly narrowedMenu!: UserMenu & BaseMenu;
}
