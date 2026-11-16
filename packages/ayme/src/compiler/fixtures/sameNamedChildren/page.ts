import { ayme } from "@ayme-dev/ayme";

import { Row as RowA } from "./listA";
import { Row as RowB } from "./listB";

@ayme
export class ListsPage {
  @ayme.child
  first!: RowA;
  @ayme.child
  second!: RowB;
}
