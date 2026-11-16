import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme
export class HashPrivateChildPom {
  @ayme.child
  readonly #heading!: Locator;

  get heading() {
    return this.#heading;
  }
}
