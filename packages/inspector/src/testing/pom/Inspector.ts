import type { Locator, Page } from "@playwright/test";

import { CollapsedLogo } from "./CollapsedLogo";
import { DetailPane } from "./DetailPane";
import { InspectorHeader } from "./InspectorHeader";
import { INSPECTOR_SELECTOR_ENGINE } from "./inspectorSelectors";
import { Navigator } from "./Navigator";
import { StructureLens } from "./StructureLens";
import { PanelShell } from "./PanelShell";
import { RunsView } from "./RunsView";
import type { RunCard } from "./RunCard";
import { WebMcpStatus } from "./WebMcpStatus";

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
  /** The WebMCP status line, while publication isn't active. */
  readonly webMcpStatus: WebMcpStatus;
  readonly logo: CollapsedLogo;
  readonly navigator: Navigator;
  readonly detail: DetailPane;
  readonly runs: RunsView;
  /** The Structure lens's tree, in the navigator. */
  readonly structure: StructureLens;

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
    this.shell = new PanelShell(this.panel);
    this.header = new InspectorHeader(
      // The panel header, inside the frame that clips the panel's content.
      this.panel.locator(":scope > div > header"),
      this.root
    );
    this.webMcpStatus = new WebMcpStatus(this.panel);
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
    this.structure = new StructureLens(this.navigator.root);
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
