import { ayme } from "@ayme-dev/ayme";

@ayme
export class StringPatternPom {
  @ayme.action({ description: "Destructure a string." })
  initial([first]: string) {
    return first;
  }
}
