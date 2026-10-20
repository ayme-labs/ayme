import { ayme as mark, ayme } from "@ayme-dev/ayme";

// The same decorator under another name still reads the shared constant,
// which declares no root.
const plain = { description: "An item." };

@mark(plain)
class FirstItem {
  @ayme.action
  open() {}
}

@ayme(plain)
class SecondItem {
  @ayme.action
  open() {}
}

@ayme
export class AliasedSharedOptionsPom {
  async first(): Promise<FirstItem[]> {
    return [];
  }

  async second(): Promise<SecondItem[]> {
    return [];
  }
}
