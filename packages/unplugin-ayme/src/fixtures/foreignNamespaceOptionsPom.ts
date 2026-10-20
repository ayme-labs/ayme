import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";
// @ts-expect-error The module does not exist, so `hooks` has no types.
import * as hooks from "untyped-foreign-hooks";

const shared = { description: "An item." };

// A namespace member nothing resolves: not known to be ayme's decorator, and
// it receives the options.
@hooks.ayme(shared)
class Hooked {}
void Hooked;

@ayme(shared)
class HookedItem {
  constructor(readonly container: Locator) {}

  @ayme.action
  open() {}
}

@ayme
export class ForeignNamespaceOptionsPom {
  async items(): Promise<HookedItem[]> {
    return [];
  }
}
