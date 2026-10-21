import { ayme } from "@ayme-dev/ayme";

// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace Lib {
  class BaseItem {}
}

// Its JavaScript may carry `@ayme({ root })`; the types do not show it.
@ayme
class Item extends Lib.BaseItem {
  @ayme.action
  open() {}
}

@ayme
export class NamespaceAmbientBaseCollectionPom {
  async items(): Promise<Item[]> {
    return [];
  }
}
