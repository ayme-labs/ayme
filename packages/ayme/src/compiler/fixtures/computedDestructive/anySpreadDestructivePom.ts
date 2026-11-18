import { ayme } from "@ayme-dev/ayme";

const options: any = { destructive: true };

@ayme
export class AnySpreadDestructivePom {
  @ayme.action({ ...options, description: "Submit the order." })
  submit() {}
}
