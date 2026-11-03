import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme({ root: (self: Toolbar) => self.root })
class Toolbar {
  readonly root!: Locator;
}

@ayme
export class ChildOnMethodPom {
  // @ts-expect-error @ayme.child declares a field or getter.
  @ayme.child
  toolbar(): Toolbar {
    return undefined as unknown as Toolbar;
  }
}
