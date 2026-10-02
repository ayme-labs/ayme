import type { Locator } from "@playwright/test";

import { BaseMenu } from "./base";

export class UserMenu extends BaseMenu {
  readonly signOutItem!: Locator;
}
