import { ayme } from "@ayme-dev/ayme";

@ayme
export class NestedElementPom {
  @ayme.action({ description: "Destructure an element." })
  pick([{ a }, b]: [{ a: string }, number]) {
    return [a, b];
  }
}
