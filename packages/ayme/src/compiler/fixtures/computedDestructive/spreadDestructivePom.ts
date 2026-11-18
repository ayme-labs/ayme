import { ayme } from "@ayme-dev/ayme";

const options: { destructive?: boolean } = { destructive: true };

@ayme
export class SpreadDestructivePom {
  @ayme.action({ description: "Submit the order.", ...options })
  submit() {}
}
