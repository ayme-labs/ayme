import type { Locator, Page } from "@playwright/test";

import { CollapsedLogo } from "./CollapsedLogo";
import { DetailPane } from "./DetailPane";
import { InspectorHeader } from "./InspectorHeader";
import { Navigator } from "./Navigator";
import { PageStateView } from "./PageStateView";
import { PanelShell } from "./PanelShell";
import { RunsView } from "./RunsView";
import type { RunCard } from "./RunCard";

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
  readonly shell: PanelShell;
  readonly header: InspectorHeader;
  readonly logo: CollapsedLogo;
  readonly navigator: Navigator;
  readonly detail: DetailPane;
  readonly runs: RunsView;
  /** The skeleton Structure lens. */
  readonly pageState: PageStateView;

  constructor(page: Page) {
    this.root = page.locator("[data-ayme-inspector-root]");
    this.panel = this.root.getByRole("complementary", {
      name: "ayme",
      exact: true,
    });
    this.shell = new PanelShell(this.panel);
    this.header = new InspectorHeader(
      this.panel.locator(":scope > header"),
      this.root
    );
    this.logo = new CollapsedLogo(
      this.root.getByRole("button", { name: "Open ayme" })
    );
    this.navigator = new Navigator(
      this.panel.getByRole("navigation", { name: "Navigator" })
    );
    this.detail = new DetailPane(
      this.panel.getByRole("region", { name: "Selected" })
    );
    this.runs = new RunsView(this.panel.getByRole("region", { name: "Runs" }));
    this.pageState = new PageStateView(this.navigator.root);
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

  /** Selects a tool in the Tools lens and returns its run card. */
  async tool(name: string): Promise<RunCard> {
    await this.navigator.showLens("Tools");
    await this.navigator.item(name).click();
    return this.detail.runCard();
  }
}
