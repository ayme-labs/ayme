import { ayme } from "@ayme-dev/ayme";
import * as ns from "@ayme-dev/ayme";

// The decorator reached through a namespace import still reads the shared
// constant, which declares no root.
const plain = { description: "An item." };

@ns.ayme(plain)
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
export class NamespacedSharedOptionsPom {
  async first(): Promise<FirstItem[]> {
    return [];
  }

  async second(): Promise<SecondItem[]> {
    return [];
  }
}
