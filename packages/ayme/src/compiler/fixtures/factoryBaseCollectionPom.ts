import { ayme } from "@ayme-dev/ayme";

@ayme
class BaseItem {}

function withRoot<T>(Base: T): T {
  return Base;
}

// The factory may add a root; the build cannot see it.
@ayme
class Item extends withRoot(BaseItem) {
  @ayme.action
  open() {}
}

@ayme
export class FactoryBaseCollectionPom {
  @ayme.collection
  async items(): Promise<Item[]> {
    return [];
  }
}
