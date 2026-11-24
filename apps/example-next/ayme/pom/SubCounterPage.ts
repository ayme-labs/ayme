import { CounterPage } from "./CounterPage";

// Deliberately undecorated: it is a Page Object Model through its decorated
// base, and the Turbopack rule must still route this file to the loader.
export class SubCounterPage extends CounterPage {}
