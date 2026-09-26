import type { Locator, Page } from "@playwright/test";

import { CollapsedLogo } from "./CollapsedLogo";
import { InspectorHeader } from "./InspectorHeader";
import { INSPECTOR_SELECTOR_ENGINE } from "./inspectorSelectors";
import { ModelView } from "./ModelView";
import { PageObjectsView } from "./PageObjectsView";
import { RunsView } from "./RunsView";

export type InspectorView = "Page objects" | "Model view" | "Runs";

/**
 * The Inspector, as a person sees it on the page. It is built from one page
 * object per part of the panel and runs on Playwright and on playwright-lite.
 * It is for tests only: it is never registered with the Ayme runtime, so its
 * actions never become WebMCP tools.
 */
export class Inspector {
  /** The Inspector's root inside its shadow root. One per mounted Inspector. */
  readonly root: Locator;
  /** The expanded panel. */
  readonly panel: Locator;
  readonly header: InspectorHeader;
  readonly logo: CollapsedLogo;
  readonly pageObjects: PageObjectsView;
  readonly modelView: ModelView;
  readonly runs: RunsView;
  private readonly views: Locator;

  /**
   * @param page a Playwright page with `registerInspectorSelectors` applied,
   *   which reaches into the Inspector's closed shadow root.
   * @param root where the Inspector's root is, when it is not behind the
   *   mount's closed shadow root: a component test renders the panel into an
   *   open root it owns.
   */
  constructor(
    page: Page,
    root: Locator = page.locator(
      `${INSPECTOR_SELECTOR_ENGINE}=[data-ayme-inspector-root]`
    )
  ) {
    this.root = root;
    this.panel = this.root.getByRole("complementary", {
      name: "ayme",
      exact: true,
    });
    this.header = new InspectorHeader(this.panel.locator("header"), this.root);
    this.logo = new CollapsedLogo(
      this.root.getByRole("button", { name: "Open Ayme POM inspector" })
    );
    this.views = this.panel.getByRole("tablist", { name: "Inspector views" });
    const view = this.panel.getByRole("tabpanel");
    this.pageObjects = new PageObjectsView(view);
    this.modelView = new ModelView(view);
    this.runs = new RunsView(view);
  }

  /** Expands the panel if it is collapsed to the logo. */
  async open() {
    await this.panel.or(this.logo.root).waitFor();
    if (await this.logo.root.isVisible()) await this.logo.open();
    await this.panel.waitFor();
  }

  async collapse() {
    await this.header.collapse();
  }

  async showView(view: InspectorView) {
    await this.views.getByRole("tab", { name: view, exact: true }).click();
  }
}
