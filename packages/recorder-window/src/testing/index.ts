// The `./testing` entry (ADR-0026): the recorder window's page objects. Only
// tests may import it. They take Playwright's Page and Locator types, so they
// run on Playwright and on playwright-lite alike.
export { Controls, type CommandName } from "./pom/Controls";
export { RecorderWindow } from "./pom/RecorderWindow";
export { Entry, Timeline, Visit, type ChangeRow } from "./pom/Timeline";
