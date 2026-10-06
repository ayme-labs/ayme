// The testing entry (ADR-0026): the Inspector's Page Object Model, which
// only tests may import. It uses Playwright's types only and runs on the
// test's own Playwright `Page` or on playwright-lite's `createPage()`. On
// Playwright, register its selector engine first: the mounted Inspector
// lives in a closed shadow root. Its classes carry `@ayme`, so a page that
// dogfoods the Inspector can compile and register it like its own Page
// Objects; this entry ships without that compiler output.
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
export { FillForm } from "./pom/FillForm";
export { KeyField } from "./pom/KeyField";
export { LocatorGroups } from "./pom/LocatorGroups";
export { Navigator, type LensName } from "./pom/Navigator";
export {
  ModelDetailView,
  type ModelDetailSection,
} from "./pom/ModelDetailView";
export { ModelLens, type ModelPaneName } from "./pom/ModelLens";
export { NodeView } from "./pom/NodeView";
export { PanelShell, type PanelEdge } from "./pom/PanelShell";
export { RefField } from "./pom/RefField";
export { RunCard, type ArgumentValue } from "./pom/RunCard";
export { RunEntry, RunsView, type RunStep } from "./pom/RunsView";
export { StructureLens } from "./pom/StructureLens";
export { ToolPage } from "./pom/ToolPage";
export { ValueRows } from "./pom/ValueRows";
export { ToolsLens, type ToolGroupLabel } from "./pom/ToolsLens";
export { WhatTheModelSees } from "./pom/WhatTheModelSees";
export { WebMcpStatus } from "./pom/WebMcpStatus";
