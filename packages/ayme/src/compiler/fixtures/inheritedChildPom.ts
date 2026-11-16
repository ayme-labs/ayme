import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme({ root: (self: BaseMenu) => self.item })
class BaseMenu {
  @ayme.child
  readonly item!: Locator;
}

class UserMenu extends BaseMenu {
  @ayme.child
  readonly signOutItem!: Locator;
}

@ayme
export class PageY {
  @ayme.child
  readonly heading!: Locator;
  @ayme.child
  readonly userMenu!: UserMenu;
  @ayme.child
  readonly narrowedMenu!: UserMenu & BaseMenu;
}
