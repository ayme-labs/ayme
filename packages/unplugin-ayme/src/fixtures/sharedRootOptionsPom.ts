import { ayme } from "@ayme-dev/ayme";
import { RootedBase } from "./sharedRootOptionsBase";

const key = "present";
const options = {};
declare class AmbientBase {}

@ayme({ [key]: () => true })
class Computed {}

@ayme({ ...options })
class Spread {}

@ayme
class Ambient extends AmbientBase {}

@ayme
class Inherited extends RootedBase {
  next!: Inherited;
}

@ayme
export class SharedRootOptionsPom {
  computed!: Computed;
  otherComputed!: Computed;
  spread!: Spread;
  otherSpread!: Spread;
  ambient!: Ambient;
  otherAmbient!: Ambient;
  inherited!: Inherited;
  otherInherited!: Inherited;

  async computedItems(): Promise<Computed[]> {
    return [];
  }
  async spreadItems(): Promise<Spread[]> {
    return [];
  }
  async ambientItems(): Promise<Ambient[]> {
    return [];
  }
  async inheritedItems(): Promise<Inherited[]> {
    return [];
  }
}
