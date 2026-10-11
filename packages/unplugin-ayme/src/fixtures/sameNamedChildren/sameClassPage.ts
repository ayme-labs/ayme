import { ayme } from "@ayme-dev/ayme";

import { Row } from "./listA";

@ayme
export class SameRowPage {
  first!: Row;
  second!: Row;

  async rows(): Promise<Row[]> {
    return [];
  }
}
