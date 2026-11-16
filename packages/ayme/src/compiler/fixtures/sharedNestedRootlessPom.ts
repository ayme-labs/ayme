import type { Locator } from "@playwright/test";
import { ayme } from "@ayme-dev/ayme";

@ayme
class Toolbar {}

@ayme({ root: (self: Panel) => self.element })
class Panel {
  element!: Locator;
  @ayme.child
  toolbar = new Toolbar();
}

@ayme
export class SharedNestedRootlessPom {
  @ayme.child
  first = new Panel();
  @ayme.child
  get second(): Panel {
    return new Panel();
  }
}
