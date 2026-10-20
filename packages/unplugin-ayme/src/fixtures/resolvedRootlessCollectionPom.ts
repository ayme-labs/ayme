import { ayme } from "@ayme-dev/ayme";

// Options the compiler reads through a constant, with no `root`.
const plain = { description: "An item." };

@ayme(plain)
class PlainItem {
  @ayme.action
  open() {}
}

@ayme
export class ResolvedRootlessCollectionPom {
  async items(): Promise<PlainItem[]> {
    return [];
  }
}
