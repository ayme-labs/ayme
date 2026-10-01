// The testing entry (ADR-0026): the Inspector's Page Object Model, which
// only tests may import. It uses Playwright's types only and runs on the
// test's own Playwright `Page` or on playwright-lite's `createPage()`. On
// Playwright, register its selector engine first: the mounted Inspector
// lives in a closed shadow root.
export { Inspector, type InspectorView } from "./pom/Inspector";
export { CollapsedLogo } from "./pom/CollapsedLogo";
export { InspectorHeader } from "./pom/InspectorHeader";
export {
  INSPECTOR_SELECTOR_ENGINE,
  registerInspectorSelectors,
} from "./pom/inspectorSelectors";
export { ModelView } from "./pom/ModelView";
export { PageObjectsView, PomClassCard } from "./pom/PageObjectsView";
export { RunsView } from "./pom/RunsView";
export { ThemeMenu, type ThemeChoice } from "./pom/ThemeMenu";
export { ToolForm, type ArgumentValue } from "./pom/ToolForm";
