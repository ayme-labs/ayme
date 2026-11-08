import { ayme } from "@ayme-dev/ayme";

@ayme
export class TupleUnionPom {
  @ayme.action({ description: "Move along two or three axes." })
  move([x]: [number, number] | [number, number, number]) {
    return x;
  }
}
