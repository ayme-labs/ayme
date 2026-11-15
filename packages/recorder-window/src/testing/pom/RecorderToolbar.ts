import type { Locator, Page, Selectors } from "@playwright/test";

import type { CommandName } from "./Controls";

/**
 * The key under which the toolbar's host element keeps its closed shadow
 * root, for these page objects only. The toolbar's mount stores the root
 * there; nothing of the page's structure, and no Playwright engine of its
 * own, reads it.
 */
// The mount writes this same text: the toolbar is a build of its own and
// shares no module with the page objects.
export const TOOLBAR_SHADOW_ROOT_KEY = "@ayme-dev/recorder-window/toolbar-root";

/** The prefix of the Playwright selector engines that reach into the
 * toolbar's closed shadow root: `<engine>=<css>`. */
export const TOOLBAR_SELECTOR_ENGINE = "ayme-recorder-toolbar";

function createToolbarEngine(key: string) {
  const roots = (scope: Element | Document) => {
    const hosts = [...scope.querySelectorAll("ayme-recorder-toolbar")];
    return hosts.flatMap((host) => {
      const root = (host as unknown as Record<symbol, ShadowRoot | undefined>)[
        Symbol.for(key)
      ];
      return root ? [root] : [];
    });
  };
  return {
    query: (scope: Element | Document, selector: string) =>
      roots(scope)
        .map((root) => root.querySelector(selector))
        .find(Boolean) ?? null,
    queryAll: (scope: Element | Document, selector: string) =>
      roots(scope).flatMap((root) => [...root.querySelectorAll(selector)]),
  };
}

let engines = 0;

/**
 * Registers a selector engine that reaches into the toolbar, under a name
 * of its own, and returns the name. Playwright gives a registered engine
 * only to the contexts it knows of then, and never to one it reaches over
 * the DevTools protocol later: a recorded browser is reached that way, so
 * each page object registers its own engine once its page is open.
 */
async function registerToolbarEngine(selectors: Selectors): Promise<string> {
  const name = `${TOOLBAR_SELECTOR_ENGINE}-${Math.random().toString(36).slice(2)}-${++engines}`;
  await selectors.register(name, {
    content: `(${createToolbarEngine.toString()})(${JSON.stringify(TOOLBAR_SHADOW_ROOT_KEY)})`,
  });
  return name;
}

/** The names the toolbar's first control has, by the state. */
const MAIN: readonly CommandName[] = ["Record", "Stop", "Continue recording"];

/**
 * The toolbar in a recorded page: a small pill with the control that
 * records, stops or continues, and Assert visibility. It hides from the
 * page's structure, so it is reached through a selector engine of its own,
 * never by role. A test presses its buttons as a person does: by their
 * place on the page.
 */
export class RecorderToolbar {
  /** The toolbar itself. */
  readonly root: Locator;
  readonly recordButton: Locator;
  readonly stopButton: Locator;
  readonly continueButton: Locator;
  /** Assert visibility: pressed, it enters picking, or leaves it. */
  readonly assertVisibility: Locator;
  /** In place of the first control while the recorder wraps up or saves:
   * it says so, and can not be pressed. */
  readonly busyIndicator: Locator;

  /** The toolbar in `page`, reached through `selectors`: `@playwright/test`'s,
   * of the same Playwright that reached the page. */
  static async on(page: Page, selectors: Selectors): Promise<RecorderToolbar> {
    return new RecorderToolbar(page, await registerToolbarEngine(selectors));
  }

  private constructor(
    readonly page: Page,
    private readonly engine: string
  ) {
    this.root = this.inside('[role="toolbar"]');
    this.recordButton = this.button("Record");
    this.stopButton = this.button("Stop");
    this.continueButton = this.button("Continue recording");
    this.assertVisibility = this.button("Assert visibility");
    this.busyIndicator = this.inside("button[data-busy]");
  }

  /** Whether the toolbar shows Assert visibility on. */
  async picking(): Promise<boolean> {
    return (
      (await this.assertVisibility.getAttribute("aria-pressed")) === "true"
    );
  }

  /** What the recorder is busy with, such as "Wrapping up, then pausing";
   * null while it is not. */
  async busy(): Promise<string | null> {
    return (await this.busyIndicator.count()) > 0
      ? this.busyIndicator.getAttribute("aria-label")
      : null;
  }

  /** The first control's name while it can be pressed: Record, Stop or
   * Continue recording; none while nothing can be. */
  async offered(): Promise<CommandName[]> {
    const offered: CommandName[] = [];
    for (const name of MAIN) {
      const control = this.button(name);
      if ((await control.count()) > 0 && (await control.isEnabled()))
        offered.push(name);
    }
    return offered;
  }

  private button(name: string): Locator {
    return this.inside(`button[aria-label="${name}"]`);
  }

  private inside(css: string): Locator {
    return this.page.locator(`${this.engine}=${css}`);
  }
}
