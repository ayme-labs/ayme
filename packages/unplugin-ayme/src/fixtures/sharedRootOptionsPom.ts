import { ayme } from "@ayme-dev/ayme";
import { RootedBase } from "./sharedRootOptionsBase";

const key = "present";
const options = {};

@ayme({ [key]: () => true })
class Computed {}

@ayme({ ...options })
class Spread {}

@ayme
class Inherited extends RootedBase {}

@ayme
export class SharedRootOptionsPom {
  async computedItems(): Promise<Computed[]> {
    return [];
  }
  async spreadItems(): Promise<Spread[]> {
    return [];
  }
  async inheritedItems(): Promise<Inherited[]> {
    return [];
  }
}
