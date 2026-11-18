import { ayme } from "@ayme-dev/ayme";

const flags: Record<string, boolean> = { destructive: true };

@ayme
export class IndexSpreadDestructivePom {
  @ayme.action({ description: "Submit the order.", ...flags })
  submit() {}
}
