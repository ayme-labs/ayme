import { ayme } from "@ayme-dev/ayme";

@ayme
export class CallablePom {
  @ayme.action({ description: "Take a callback." })
  run(callback: () => void) {
    callback();
  }
}
