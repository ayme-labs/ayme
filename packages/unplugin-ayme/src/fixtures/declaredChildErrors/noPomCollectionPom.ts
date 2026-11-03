import { ayme } from "@ayme-dev/ayme";

@ayme
export class NoPomCollectionPom {
  @ayme.collection
  async labels(): Promise<string[]> {
    return [];
  }
}
