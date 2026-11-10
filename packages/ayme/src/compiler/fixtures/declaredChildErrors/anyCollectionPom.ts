import { ayme } from "@ayme-dev/ayme";

@ayme
export class AnyCollectionPom {
  @ayme.collection
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async parts(): Promise<any[]> {
    return [];
  }
}
