import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme({ root: (self: Toolbar) => self.root })
class Toolbar {
  readonly root!: Locator;
}

@ayme
export class SingleMethodPom {
  @ayme.collection
  async toolbar(): Promise<Toolbar> {
    return undefined as unknown as Toolbar;
  }
}
