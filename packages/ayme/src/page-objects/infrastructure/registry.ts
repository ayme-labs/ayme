import { litePageDriver } from "./litePageDriver";
import { createPomRegistry } from "../application/pomRegistry";

// The registry's interface includes registering the compiled manifests its
// registrations read.
export {
  constructPageObject,
  registerCompiledPom,
  type PageObjectConstructor,
} from "../application/compiledPoms";
export type {
  CallerAwarePomTool,
  CollectionToolItem,
  RegisteredPom,
  RegisteredPomRoot,
} from "../application/pomRegistry";

/**
 * The browser runtime's Page Object registry, which reads the page through
 * Playwright Lite.
 */
export const {
  getRegisteredPomStructure,
  listAvailablePomTools,
  listCollectionToolItems,
  listRegisteredPomRoots,
  listRegisteredPomTargets,
  listRegisteredPomTools,
  listRegisteredPoms,
  probeRegisteredPomMembers,
  registerPageObject,
  resetRegisteredPoms,
  subscribeToRegisteredPoms,
} = createPomRegistry(litePageDriver);
