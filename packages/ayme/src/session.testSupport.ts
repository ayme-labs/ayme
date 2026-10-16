/**
 * Test support: a started runtime session on a test's page, so a test
 * registers its Page Objects the way an app's components do, through the
 * session's `pom.register` and `pom.unregister`.
 */
import type { Page } from "@playwright/test";
import { createPage } from "./browserPage";
import { createAyme, type AymePage } from "./runtime";

/**
 * Starts a session on `page`, with WebMCP publication off. `stop` ends it
 * and frees the runtime for the next test.
 */
export function startSession(page: Page | AymePage = createPage()) {
  const ayme = createAyme({
    pageFactory: () => page as AymePage,
    webMCP: { enabled: false },
  });
  const stop = ayme.start();
  return {
    page,
    ayme,
    register: ayme.pom.register,
    unregister: ayme.pom.unregister,
    stop,
  };
}

export type TestSession = ReturnType<typeof startSession>;
