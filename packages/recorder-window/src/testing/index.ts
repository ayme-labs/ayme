// The `./testing` entry (ADR-0026): the recorder window's and the toolbar's
// page objects. Only tests may import it. They take Playwright's Page and
// Locator types, so they run on Playwright and on playwright-lite alike.
export { Controls, type CommandName, type ThemeChoice } from "./pom/Controls";
export { RecorderWindow } from "./pom/RecorderWindow";
export {
  ChangeRow,
  Entry,
  Timeline,
  Visit,
  type WhatChanged,
} from "./pom/Timeline";
export { RecorderToolbar } from "./pom/RecorderToolbar";
