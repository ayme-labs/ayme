import { registerRefSelectorEngine } from "../../page-state/infrastructure";
import { createPage } from "./browserPage";
import { browserRegistry } from "./registry";

/**
 * Makes a runtime session the owner of the browser's Page Object registry
 * (the document's), with no Page Object registered; one owner at a time.
 */
export function createAymeRuntime(page?: object) {
  const release = browserRegistry().claim();
  let runtimePage: object;
  try {
    runtimePage = page ?? createPage();
  } catch (error) {
    release();
    throw error;
  }
  // The page's locators for Structural Refs resolve through Ayme's engine.
  registerRefSelectorEngine();

  return { page: runtimePage, dispose: release };
}
