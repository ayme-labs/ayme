import { ayme } from "@ayme-dev/ayme";

@ayme
class BaseItem {}

function withRoot<T>(Base: T): T {
  return Base;
}

const RootedBase = withRoot(BaseItem);

// The factory may add a root; the build cannot see it.
@ayme
class Item extends RootedBase {
  @ayme.action
  open() {}
}

@ayme
export class ConstFactoryBaseCollectionPom {
  async items(): Promise<Item[]> {
    return [];
  }
}
