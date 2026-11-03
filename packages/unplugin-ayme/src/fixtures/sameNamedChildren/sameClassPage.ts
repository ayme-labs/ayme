import { ayme } from "@ayme-dev/ayme";

import { Row } from "./listA";

@ayme
export class SameRowPage {
  @ayme.child
  first!: Row;
  @ayme.child
  second!: Row;

  @ayme.collection
  async rows(): Promise<Row[]> {
    return [];
  }
}
