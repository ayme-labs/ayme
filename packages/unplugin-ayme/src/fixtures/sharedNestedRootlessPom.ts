import type { Locator } from "@playwright/test";
import { ayme } from "@ayme-dev/ayme";

@ayme
class Toolbar {}

@ayme({ root: (self: Panel) => self.element })
class Panel {
  element!: Locator;
  toolbar = new Toolbar();
}

@ayme
export class SharedNestedRootlessPom {
  first = new Panel();
  get second(): Panel {
    return new Panel();
  }
}
