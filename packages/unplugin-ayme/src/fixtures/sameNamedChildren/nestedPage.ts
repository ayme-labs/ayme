import { ayme } from "@ayme-dev/ayme";

import { Row } from "./listA";
import { Table } from "./listB";

// The clash is one level down: Table's own Row is listB's.
@ayme
export class NestedListsPage {
  row!: Row;
  table!: Table;
}
