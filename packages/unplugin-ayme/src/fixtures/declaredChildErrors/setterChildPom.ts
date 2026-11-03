import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme
export class SetterChildPom {
  // Legacy decorators accept a setter; standard ones do not.
  // @ts-expect-error @ayme.child declares a field or getter.
  @ayme.child
  set part(value: Locator) {
    void value;
  }
}
