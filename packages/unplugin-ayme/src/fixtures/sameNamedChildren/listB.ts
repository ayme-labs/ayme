import { ayme } from "@ayme-dev/ayme";

@ayme
export class Row {
  @ayme.action
  async remove(): Promise<void> {}
}

@ayme
export class Table {
  @ayme.child
  row!: Row;
}
