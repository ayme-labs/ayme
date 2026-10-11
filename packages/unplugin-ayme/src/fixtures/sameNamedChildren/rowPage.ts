import { ayme } from "@ayme-dev/ayme";

import { Row as ListRow } from "./listA";

// A Page Object named like one of its Children.
@ayme
export class Row {
  item!: ListRow;
}
