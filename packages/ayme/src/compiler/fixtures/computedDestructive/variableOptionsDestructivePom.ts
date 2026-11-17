import { ayme } from "@ayme-dev/ayme";

const options = { destructive: true };

@ayme
export class VariableOptionsDestructivePom {
  @ayme.action(options)
  submit() {}
}
