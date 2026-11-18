import type { Browser, BrowserTab } from "@e2e-dev/web";
import type { Locator, Screen } from "e2e";

/**
 * One tab a test drives: the fixture page's, or, in the external placement,
 * the Inspector window's. e2e's `screen` and every locator act on whichever
 * tab is active, so a Page Object brings its own tab to the front before it
 * acts or reads. In the inline placement both are the same tab.
 */
export class Tab {
  constructor(
    readonly screen: Screen,
    readonly browser: Browser,
    private readonly tab: BrowserTab
  ) {}

  /** Makes this the active tab, if it is not. */
  async front() {
    if (!this.tab.isActive()) await this.tab.activate();
  }

  /** `query` on this tab's screen, as a locator that brings the tab forward. */
  on(query: (screen: Screen) => Locator): On {
    return new On(this, query(this.screen));
  }

  /** A Playwright selector on this tab, such as the fixture page's own CSS. */
  locator(selector: string): On {
    return new On(this, this.browser.locator(selector));
  }

  /**
   * CSS that crosses the Inspector's closed shadow root, for the few parts
   * no role, name or label tells apart, such as a list's own items and not
   * the ones nested in them (`> li`). e2e documents no way for CSS to cross
   * a closed root: `browser.locator` stops at it. Its web engine registers
   * the `e2e-roots=` selector for its own queries, which runs CSS in the
   * document and in every closed root under it; this is the one place the
   * suite relies on it, so an e2e upgrade that changes it fails here.
   */
  css(selector: string): On {
    return new On(this, this.browser.locator(`e2e-roots=${selector}`));
  }
}

/**
 * A locator on one tab. Every action and read brings the tab to the front
 * first; `front()` does so for an `expect`, which takes the locator. The bare
 * locator is not handed out otherwise: used while another tab is active, it
 * would find nothing, and a negated assertion would pass.
 */
export class On {
  constructor(
    private readonly tab: Tab,
    private readonly locator: Locator
  ) {}

  /** The locator, with its tab in front: `expect(await x.front())`. */
  async front(): Promise<Locator> {
    await this.tab.front();
    return this.locator;
  }

  /** A narrower locator on the same tab. */
  within(narrow: (locator: Locator) => Locator): On {
    return new On(this.tab, narrow(this.locator));
  }

  async click() {
    await (await this.front()).click();
  }

  async hover() {
    await (await this.front()).hover();
  }

  async fill(value: string) {
    await (await this.front()).fill(value);
  }

  async check() {
    await (await this.front()).check();
  }

  async count() {
    return (await this.front()).count();
  }

  async isVisible() {
    return (await this.front()).isVisible();
  }

  async textContent() {
    return (await this.front()).textContent();
  }

  async getAttribute(name: string) {
    return (await this.front()).getAttribute(name);
  }
}
