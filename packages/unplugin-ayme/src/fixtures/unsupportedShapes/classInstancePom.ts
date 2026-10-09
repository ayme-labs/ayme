import { ayme } from "@ayme-dev/ayme";

@ayme
export class ClassInstancePom {
  @ayme.action({ description: "Take a date." })
  schedule(at: Date) {
    return at;
  }
}
