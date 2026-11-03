import { ayme } from "@ayme-dev/ayme";

@ayme
export class HolePom {
  @ayme.action({ description: "Skip an element." })
  move([, y]: [number, number]) {
    return y;
  }
}
