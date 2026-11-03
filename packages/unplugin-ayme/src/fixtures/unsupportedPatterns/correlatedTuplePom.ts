import { ayme } from "@ayme-dev/ayme";

@ayme
export class CorrelatedTuplePom {
  @ayme.action({ description: "Take a pair either way round." })
  pair([x, y]: [string, number] | [number, string]) {
    return [x, y];
  }
}
