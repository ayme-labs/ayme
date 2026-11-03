import { ayme } from "@ayme-dev/ayme";

@ayme
export class ArrayDuplicatePom {
  @ayme.action({ description: "Bind a property an object pattern takes." })
  move({ y }: { x: number; y: number }, [x]: [number]) {
    return [x, y];
  }
}
