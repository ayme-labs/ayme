import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

@ayme
export class SetterCollectionPom {
  get parts(): Locator {
    return undefined as unknown as Locator;
  }

  // Legacy decorators accept a setter; standard ones do not.
  // @ts-expect-error @ayme.collection declares a field, getter or method.
  @ayme.collection
  set parts(value: Locator) {
    void value;
  }
}
