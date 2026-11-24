import { CounterPage } from "./CounterPage";

// Deliberately undecorated: it is a Page Object Model through its decorated
// base, and the build plugin must still compile it.
export class SubCounterPage extends CounterPage {}
