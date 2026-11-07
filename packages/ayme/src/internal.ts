// The internal entry (ADR-0049) keeps only what the framework packages, the
// build plugin's generated code and the inspector-fixture app use: the
// compiled Page Object registration and manifest the build plugin writes and
// the runtime reads (both ship together, so it is no public contract), the
// render-session marker and runtime-options check the framework packages use,
// and the registry read model the framework tests check. The Inspector does
// not come through here: it reads ./inspector.
export {
  getStartedAyme,
  markRenderSession,
  sameRuntimeOptions,
  snapshotRuntimeOptions,
} from "./runtime";
export { listRegisteredPoms } from "./page-objects/infrastructure";
export { registerCompiledPom } from "./page-objects/application";
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
