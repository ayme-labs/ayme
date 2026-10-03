import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme
export abstract class BaseMenu {
  readonly baseItem!: Locator;

  @ayme.action({ description: "Open the menu." })
  open() {}
}

export class UserMenu extends BaseMenu {
  readonly signOutItem!: Locator;

  @ayme.action({ description: "Sign out." })
  signOut() {}

  describe(value: string) {
    return value;
  }
}

// An anonymous class has no binding to register, so it is not recognised.
export default class extends BaseMenu {}
