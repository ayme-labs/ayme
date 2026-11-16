import { ayme } from "@ayme-dev/ayme";

import { Row } from "./listA";
import { Table } from "./listB";

// The clash is one level down: Table's own Row is listB's.
@ayme
export class NestedListsPage {
  @ayme.child
  row!: Row;
  @ayme.child
  table!: Table;
}
