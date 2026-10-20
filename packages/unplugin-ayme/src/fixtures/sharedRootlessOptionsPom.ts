import { ayme } from "@ayme-dev/ayme";

// One constant, read by two decorators and nothing else: still readable,
// and it declares no root.
const plain = { description: "An item." };

@ayme(plain)
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
export class SharedRootlessOptionsPom {
  async first(): Promise<FirstItem[]> {
    return [];
  }

  async second(): Promise<SecondItem[]> {
    return [];
  }
}
