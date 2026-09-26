// The testing entry (ADR-0026): the Inspector's Page Object Model, which
// only tests may import. It uses Playwright's types only and runs on the
// test's own Playwright `Page` or on playwright-lite's `createPage()`.
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
export { Navigator, type LensName } from "./pom/Navigator";
export { PageObjectsView, PomClassCard } from "./pom/PageObjectsView";
export { PageStateView } from "./pom/PageStateView";
export { PanelShell, type PanelEdge } from "./pom/PanelShell";
export { RunsView } from "./pom/RunsView";
export { ToolForm, type ArgumentValue } from "./pom/ToolForm";
export { ToolPage } from "./pom/ToolPage";
export { ToolsLens, type ToolGroupLabel } from "./pom/ToolsLens";
export { WhatTheModelSees } from "./pom/WhatTheModelSees";
