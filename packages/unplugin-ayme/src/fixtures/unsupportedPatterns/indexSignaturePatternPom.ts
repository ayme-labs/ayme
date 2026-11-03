import { ayme } from "@ayme-dev/ayme";

@ayme
export class IndexSignaturePatternPom {
  @ayme.action({ description: "Destructure a record." })
  pick({ a }: Record<string, string>) {
    return a;
  }
}
