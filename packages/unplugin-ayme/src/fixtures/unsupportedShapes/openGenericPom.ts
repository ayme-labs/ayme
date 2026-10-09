import { ayme } from "@ayme-dev/ayme";

@ayme
export class OpenGenericPom {
  @ayme.action({ description: "Take anything." })
  pick<T>(value: T) {
    return value;
  }
}
