import { AliasedPage } from "@poms/AliasedPage";
import { CounterPage } from "./CounterPage";
import { SubCounterPage } from "./SubCounterPage";
import { Base } from "./base";

// Stands in for an Angular component: it extends a class and imports Page
// Object Models, yet it must stay with Angular's compiler.
export class Counter extends Base {
  readonly models = [CounterPage, SubCounterPage, AliasedPage];
}
