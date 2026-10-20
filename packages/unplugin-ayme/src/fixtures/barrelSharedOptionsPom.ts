import { ayme, ayme as mark } from "./barrel";

// ayme re-exported through a barrel still reads the shared constant,
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
export class BarrelSharedOptionsPom {
  async first(): Promise<FirstItem[]> {
    return [];
  }

  async second(): Promise<SecondItem[]> {
    return [];
  }
}
