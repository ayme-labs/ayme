// Baseline: the decorators module on its own, as if it were its own entry.
import { ayme } from "../../../../../packages/ayme/src/decorators";

@ayme
export class CounterPage {
  @ayme.action
  increment() {}
}
