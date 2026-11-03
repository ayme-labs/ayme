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
  @ayme.collection
  async computedItems(): Promise<Computed[]> {
    return [];
  }
  @ayme.collection
  async spreadItems(): Promise<Spread[]> {
    return [];
  }
  @ayme.collection
  async inheritedItems(): Promise<Inherited[]> {
    return [];
  }
}
