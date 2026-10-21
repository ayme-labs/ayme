import { ayme } from "@ayme-dev/ayme";

// Its JavaScript may carry `@ayme({ root })`; the types do not show it.
declare class AmbientBase {}

@ayme
class Item extends AmbientBase {
  @ayme.action
  open() {}
}

@ayme
export class AmbientBaseCollectionPom {
  async items(): Promise<Item[]> {
    return [];
  }
}
