import { ayme } from "@ayme-dev/ayme";

import { Row as RowA } from "./listA";
import { Row as RowB } from "./listB";

@ayme
export class ListsPage {
  first!: RowA;
  second!: RowB;
}
