import type { Locator } from "@playwright/test";

import { WebMCP } from "./webmcp";

@WebMCP
export abstract class BaseMenu {
  readonly baseItem!: Locator;

  @WebMCP.tool({ description: "Open the menu." })
  open() {}
}

export class UserMenu extends BaseMenu {
  readonly signOutItem!: Locator;

  @WebMCP.tool({ description: "Sign out." })
  signOut() {}

  describe(value: string) {
    return value;
  }
}

// An anonymous class has no binding to register, so it is not recognised.
export default class extends BaseMenu {}
