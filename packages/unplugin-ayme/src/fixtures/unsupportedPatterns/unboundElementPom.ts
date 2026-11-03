import { ayme } from "@ayme-dev/ayme";

@ayme
export class UnboundElementPom {
  @ayme.action({ description: "Leave an element unbound." })
  move([x]: [number, number]) {
    return x;
  }
}
