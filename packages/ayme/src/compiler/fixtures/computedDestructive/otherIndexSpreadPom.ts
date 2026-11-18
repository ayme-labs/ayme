import { ayme } from "@ayme-dev/ayme";

const handlers: Record<`on${string}`, boolean> = {};

@ayme
export class OtherIndexSpreadPom {
  @ayme.action({ description: "Submit the order.", ...handlers })
  submit() {}
}
