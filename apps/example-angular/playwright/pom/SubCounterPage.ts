import { CounterPage } from "./CounterPage";

// Deliberately undecorated: it is a Page Object Model through its decorated
// base, and the plugin must still claim and compile this file.
export class SubCounterPage extends CounterPage {}
