// A Page Object Model module that only marks, as a browser bundle sees it.
import { ayme } from "./combined.mjs";

@ayme
export class CounterPage {
  @ayme.action
  increment() {}
}
