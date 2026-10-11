import { ayme } from "@ayme-dev/ayme";

import { Row } from "./listA";
import type { Row as OtherRow } from "./listB";

@ayme
export class ReturningListsPage {
  row!: Row;

  @ayme.action
  async openOther(): Promise<OtherRow> {
    throw new Error("Not called.");
  }
}
