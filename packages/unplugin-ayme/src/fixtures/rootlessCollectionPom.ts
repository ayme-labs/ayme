import { ayme } from "@ayme-dev/ayme";

// A collection item class with no `root` anywhere in its chain.
@ayme
class RootlessItem {
  @ayme.action
  open() {}
}

@ayme
export class RootlessCollectionPom {
  async items(): Promise<RootlessItem[]> {
    return [];
  }
}
