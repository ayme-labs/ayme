import { ayme } from "@ayme-dev/ayme";

@ayme
export class Row {
  @ayme.action
  async open(): Promise<void> {}
}
