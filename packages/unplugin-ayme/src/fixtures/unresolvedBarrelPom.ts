import { ayme } from "./brokenBarrel";

// ayme's import cannot be followed: the options are left to the runtime.
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
export class UnresolvedBarrelPom {
  async first(): Promise<FirstItem[]> {
    return [];
  }

  async second(): Promise<SecondItem[]> {
    return [];
  }
}
