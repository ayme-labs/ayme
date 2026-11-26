// A Session as the Host of a Tab: the project's own Node Host of
// @ayme-dev/ayme over the Tab's Playwright page, running the built Page
// Objects there. ayme reaches the page only through that page, from Node.
import { pathToFileURL } from "node:url";
import { Effect } from "effect";
import type { Page } from "playwright-core";

import type { HostedTab } from "../../../session/application";
import { SessionStartError, TabReadError } from "../../../session/domain";
import type { NodePageObjects } from "../../../page-objects/infrastructure";
import { listedTools, type NodeHostTool } from "../listedTools";

/** What the Session uses of the project's `@ayme-dev/ayme/playwright`. */
type NodeHostEntry = {
  createAyme(options: { page: Page; pageObjects: readonly unknown[] }): {
    start(): Promise<() => void>;
    readonly tools: {
      list(): readonly NodeHostTool[];
      run(
        name: string,
        input: unknown,
        options: { by: string }
      ): Promise<unknown>;
    };
  };
};

/** The Caller a Session's commands start their Runs as. */
const CALLER = "ayme-command";

const reason = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Makes the Session the Host of `page`, running `pageObjects` there. The
 * Node Host's start sets up the page's binding and its in-page helper
 * without waiting for either, so it reads nothing of the page.
 */
export const hostTab = (
  page: Page,
  { classes, nodeHost }: NodePageObjects
): Effect.Effect<HostedTab, SessionStartError> =>
  Effect.tryPromise({
    try: async () => {
      const entry = (await import(
        pathToFileURL(nodeHost).href
      )) as NodeHostEntry;
      const ayme = entry.createAyme({ page, pageObjects: classes });
      await ayme.start();
      return ayme;
    },
    catch: (cause) =>
      new SessionStartError(
        `ayme could not run the project's Page Objects on the page: ${reason(cause)}`
      ),
  }).pipe(
    Effect.map((ayme) => ({
      listing: Effect.tryPromise({
        // A read of the tree takes the Tab's turn, so it waits for a Run
        // under way, and leaves every tool's availability current.
        try: async () => ({
          pageObjectTree: String(
            await ayme.tools.run("page_objects", {}, { by: CALLER })
          ),
          tools: listedTools(ayme.tools.list()),
          tab: { url: page.url(), title: await page.title() },
        }),
        catch: (cause) =>
          new TabReadError(`ayme could not read the page: ${reason(cause)}`),
      }),
    }))
  );
