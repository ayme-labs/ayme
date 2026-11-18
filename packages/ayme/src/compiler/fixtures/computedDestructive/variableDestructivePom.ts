import { ayme } from "@ayme-dev/ayme";

const DESTRUCTIVE = true;

@ayme
export class VariableDestructivePom {
  @ayme.action({ destructive: DESTRUCTIVE })
  submit() {}
}
