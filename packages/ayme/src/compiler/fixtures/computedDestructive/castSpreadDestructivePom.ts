import { ayme } from "@ayme-dev/ayme";

const options = { destructive: true };

@ayme
export class CastSpreadDestructivePom {
  @ayme.action({ ...(options as {}), description: "Submit the order." })
  submit() {}
}
