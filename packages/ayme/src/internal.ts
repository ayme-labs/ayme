// The internal entry (ADR-0049) keeps only what the framework packages, the
// build plugin's generated code, the inspector-fixture app and the Session
// of the `ayme` command use: the compiled Page Object registration and
// manifest the build plugin writes and the runtime reads (both ship
// together, so it is no public contract), the render-session marker and
// runtime-options check the framework packages use, and the registry read
// model the framework tests check. The Inspector does not come through here:
// it reads ./inspector. Its tests do, for the runtime side of the Inspector
// contract they stand a session in with, and for the in-page module of the
// document their own runtime runs in: both must be the built ones the
// Inspector under test talks to (ADR-0057). The Goal Loop's run result,
// where a document keeps it and the bars the Step Decision stops on are here
// for the playground's goal lane, which reads them from the build it runs:
// ayme's source needs ayme's own build, so another workspace cannot take
// them from it. The Session of the `ayme` command runs a project's Page
// Objects through here: it creates a Node Host for each Tab on the
// Playwright that drives its browser, all of them taking their Page Object
// Ids from one source, and reads a Run's short answer and a listing, each in
// the Tab's turn, and serves each Tab's Inspector contract to its Inspector
// window.
export {
  getStartedAyme,
  markRenderSession,
  sameRuntimeOptions,
  snapshotRuntimeOptions,
} from "./runtime";
export { listRegisteredPoms } from "./page-objects/infrastructure";
export {
  createPageObjectIdSource,
  registerCompiledPom,
} from "./page-objects/application";
export type { PageObjectConstructor } from "./page-objects/application";
// The compiled Page Object manifest's types, as the build plugin derives it.
export type {
  NamedToolParameter,
  PomComponentManifest,
  PomManifest,
  PomMemberAccess,
  PomMemberManifest,
  ToolManifest,
  ToolParameter,
} from "./shared";
// The build plugin's rule for a class with no root.
export { rootlessClassRefusals } from "./page-objects/domain";
export { DONE_BAR, LOWER_BAR } from "./goal-loop/application";
export type {
  GoalLoopRunResult,
  GoalLoopRunResultStore,
  GoalLoopStepScore,
} from "./goal-loop/application";
export { goalLoopRunResultKey } from "./goal-loop/domain";
export { inPage } from "./in-page";
export { createHighlights, createInspectorContract } from "./runtime";
export type {
  Highlightable,
  InspectorContractPorts,
  InspectorSession,
} from "./runtime";
export { createNodeHost, inspectorPortOf, pageObjectCallerOf } from "./runtime";
