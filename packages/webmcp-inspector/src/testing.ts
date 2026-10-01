// The testing entry (ADR-0026): the Inspector's Page Object Model, which
// only tests may import. It uses Playwright's types only and runs on the
// test's own Playwright `Page` or on playwright-lite's `createPage()`. On
// Playwright, register its selector engine first: the mounted Inspector
// lives in a closed shadow root.
export { Inspector } from "./pom/Inspector";
export { CollapsedLogo } from "./pom/CollapsedLogo";
export { DetailPane } from "./pom/DetailPane";
export {
  InspectorHeader,
  LayoutMenu,
  ThemeSwitch,
  type LayoutChoice,
  type ThemeChoice,
} from "./pom/InspectorHeader";
export {
  INSPECTOR_SELECTOR_ENGINE,
  registerInspectorSelectors,
} from "./pom/inspectorSelectors";
export { Navigator, type LensName } from "./pom/Navigator";
export {
  ModelDetailView,
  type ModelDetailSection,
} from "./pom/ModelDetailView";
export { ModelLens, type ModelPaneName } from "./pom/ModelLens";
export { NodeView } from "./pom/NodeView";
export { PanelShell, type PanelEdge } from "./pom/PanelShell";
export { RunCard, type ArgumentValue } from "./pom/RunCard";
export { RunEntry, RunsView, type RunStep } from "./pom/RunsView";
export { StructureLens } from "./pom/StructureLens";
export { WebMcpStatus } from "./pom/WebMcpStatus";
