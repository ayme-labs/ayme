import { ayme } from "@ayme-dev/ayme";

@ayme
export class AnyPromiseCollectionPom {
  @ayme.collection
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async parts(): Promise<any> {
    return [];
  }
}
