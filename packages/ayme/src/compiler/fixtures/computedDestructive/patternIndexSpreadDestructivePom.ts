import { ayme } from "@ayme-dev/ayme";

const flags: Record<`destructive${string}`, boolean> = { destructive: true };

@ayme
export class PatternIndexSpreadDestructivePom {
  @ayme.action({ description: "Submit the order.", ...flags })
  submit() {}
}
