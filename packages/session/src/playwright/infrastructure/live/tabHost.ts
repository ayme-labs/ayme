// A Session as the Host of a Tab: the project's own Node Host of
// @ayme-dev/ayme over the Tab's Playwright page, running the built Page
// Objects there. ayme reaches the page only through that page, from Node.
import { pathToFileURL } from "node:url";
import { Effect } from "effect";
import type { Page } from "playwright-core";

import type { HostedTab } from "../../../session/application";
import {
  SessionStartError,
  TabReadError,
  type RunAnswer,
} from "../../../session/domain";
import type { NodePageObjects } from "../../../page-objects/infrastructure";
import { listedTools, type NodeHostTool } from "../listedTools";
import { runErrorOf } from "../runError";

/** What the Session uses of the project's `@ayme-dev/ayme/internal`. */
type NodeHostEntry = {
  createNodeHost(
    options: { page: Page; pageObjects: readonly unknown[] },
    selectors: unknown
  ): { start(): Promise<() => void> };
  pageObjectCallerOf(
    ayme: unknown,
    by: string
  ): {
    run(name: string, input: unknown): Promise<RunAnswer>;
    listing(): Promise<{
      pageObjectTree: string;
      tools: readonly NodeHostTool[];
      url: string;
      title: string;
    }>;
  };
};

/** The Caller a Session's commands start their Runs as. */
const CALLER = "ayme-command";

const reason = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Makes the Session the Host of `page`, running `pageObjects` there, on the
 * Playwright whose `selectors` drive the page: the one `@ayme-dev/browser`
 * found, where the Node Host registers its selector engine. The Node Host's
 * start sets up the page's binding and its in-page helper without waiting
 * for either, so it reads nothing of the page.
 */
export const hostTab = (
  page: Page,
  selectors: unknown,
  { classes, nodeHost }: NodePageObjects
): Effect.Effect<HostedTab, SessionStartError> =>
  Effect.tryPromise({
    try: async () => {
      const entry = (await import(
        pathToFileURL(nodeHost).href
      )) as NodeHostEntry;
      const ayme = entry.createNodeHost(
        { page, pageObjects: classes },
        selectors
      );
      await ayme.start();
      return entry.pageObjectCallerOf(ayme, CALLER);
    },
    catch: (cause) =>
      new SessionStartError(
        `ayme could not run the project's Page Objects on the page: ${reason(cause)}`
      ),
  }).pipe(
    Effect.map((caller) => ({
      // Each takes the Tab's turn, so it waits for the Run under way.
      listing: Effect.tryPromise({
        try: async () => {
          const { pageObjectTree, tools, url, title } = await caller.listing();
          return {
            pageObjectTree,
            tools: listedTools(tools),
            tab: { url, title },
          };
        },
        catch: (cause) =>
          new TabReadError(`ayme could not read the page: ${reason(cause)}`),
      }),
      call: (tool, input) =>
        Effect.tryPromise({
          try: () => caller.run(tool, input),
          catch: runErrorOf,
        }),
    }))
  );
