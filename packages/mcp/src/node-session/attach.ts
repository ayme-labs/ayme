// Spike: the attach. The developer's browser automation owns the browser;
// Ayme joins it over CDP with the project's own Playwright and takes the one
// tab the agent marked.
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { Browser, Page } from "@playwright/test";

type Playwright = typeof import("@playwright/test");
type AgentTool = {
  name: string;
  group?: string;
  description?: string;
  inputSchema: unknown;
};

/** What the spike uses of the project's `@ayme-dev/ayme/playwright`. */
export type AymePlaywright = {
  createAyme(options: { page: Page; pageObjects: readonly unknown[] }): {
    start(): Promise<() => void>;
    agentTools: {
      list(): readonly AgentTool[];
      subscribe(listener: (tools: readonly AgentTool[]) => void): () => void;
      run(name: string, input: unknown): Promise<unknown>;
    };
  };
  registerAymeRef(selectors: Playwright["selectors"]): Promise<void>;
};

/** The global the agent writes its token to, through its own automation. */
export const MARK = "__aymeMark";

/** How long one tab gets to answer what its mark is: a tab held by a dialog never does. */
const MARK_TIMEOUT_MS = 3000;

function resolveFrom(folder: string, specifier: string): string {
  try {
    return createRequire(join(folder, "index.js")).resolve(specifier);
  } catch {
    throw new Error(
      `Ayme needs ${specifier}, which does not resolve from ${folder}.`
    );
  }
}

/**
 * The project's `@ayme-dev/ayme/playwright`, resolved from `folder`, and the
 * Playwright that entry itself imports, so the selectors Ayme registers its
 * engine on are those of the connection.
 */
export async function loadProjectAyme(
  folder: string
): Promise<{ ayme: AymePlaywright; playwright: Playwright }> {
  const aymeFile = resolveFrom(folder, "@ayme-dev/ayme/playwright");
  const playwrightFile = createRequire(aymeFile).resolve("@playwright/test");
  const [ayme, playwright] = await Promise.all([
    import(pathToFileURL(aymeFile).href) as Promise<AymePlaywright>,
    import(pathToFileURL(playwrightFile).href) as Promise<
      Playwright & { default?: Playwright }
    >,
  ]);
  return { ayme, playwright: playwright.default ?? playwright };
}

/**
 * Connects to the browser at `endpoint` without Playwright's defaults, and
 * resolves with the one tab whose `window.__aymeMark` is `mark`. Throws,
 * with the connection closed, when no tab or more than one has it.
 */
export async function attach(
  { ayme, playwright }: { ayme: AymePlaywright; playwright: Playwright },
  endpoint: string,
  mark: string
): Promise<{ browser: Browser; page: Page }> {
  const browser = await playwright.chromium.connectOverCDP(endpoint, {
    noDefaults: true,
  });
  // After the connection: Playwright 1.64 hands an engine registered before
  // it only to contexts it creates, so on the browser's own context
  // `ayme-ref=` would be an unknown engine. Registered now, it reaches the
  // contexts that exist. The session's own registration, on start, is then a
  // no-op: it is once per process.
  await ayme.registerAymeRef(playwright.selectors);
  // Playwright's client dismisses a dialog nobody listens for. The owning
  // automation answers dialogs; Ayme's client must leave them open.
  for (const context of browser.contexts()) context.on("dialog", () => {});
  const pages = browser.contexts().flatMap((context) => context.pages());
  const marks = await Promise.all(
    pages.map((page) =>
      Promise.race([
        page.evaluate((name) => (window as never)[name] as unknown, MARK),
        new Promise((resolve) => setTimeout(resolve, MARK_TIMEOUT_MS)),
      ]).catch(() => undefined)
    )
  );
  const marked = pages.filter((_, index) => marks[index] === mark);
  if (marked.length !== 1) {
    await browser.close().catch(() => {});
    throw new Error(
      marked.length === 0
        ? `None of the browser's ${pages.length} tabs has window.${MARK} set to "${mark}". Set it in the tab with your browser automation's eval command, then start again.`
        : `${marked.length} tabs have window.${MARK} set to "${mark}": ${marked.map((page) => page.url()).join(", ")}. Set a mark of its own in the tab you mean, then start again.`
    );
  }
  return { browser, page: marked[0]! };
}
