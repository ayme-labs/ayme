import type { Locator } from "@playwright/test";

import { ayme } from "@ayme-dev/ayme";

import { ayme as tag } from "./foreignDecorators";

const shared = { description: "An item." };

// Not a Page Object: `tag` is another module's decorator, and it receives the
// options before ayme does, so the compiler cannot read them.
@tag(shared)
class Tagged {}
void Tagged;

@ayme(shared)
class TaggedItem {
  constructor(readonly container: Locator) {}

  @ayme.action
  open() {}
}

@ayme
export class ForeignAliasOptionsPom {
  async items(): Promise<TaggedItem[]> {
    return [];
  }
}
