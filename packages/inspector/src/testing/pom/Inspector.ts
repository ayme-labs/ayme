import { ayme } from "@ayme-dev/ayme";
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
 * Tests drive the panel through it. An app never registers it with the Ayme
 * runtime, so its actions never become tools; only a page mounted with
 * `dogfood` does, so agents drive the panel the way tests do.
 */
@ayme
export class Inspector {
  /**
   * The Inspector's themed container inside its shadow root. Not `root`: a
   * Page Object Root must be visible for its tools to be live, and this
   * element has no size of its own.
   */
  readonly container: Locator;
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
   * @param container where the Inspector's container is, when it is not behind the
   *   mount's closed shadow root: a component test renders the panel into an
   *   open root it owns.
   */
  constructor(
    page: Page,
    container: Locator = page.locator(
      `${INSPECTOR_SELECTOR_ENGINE}=[data-ayme-inspector-root]`
    )
  ) {
    this.container = container;
    this.panel = this.container.getByRole("complementary", {
      name: "ayme",
      exact: true,
    });
    this.shell = new PanelShell(this.panel);
    this.header = new InspectorHeader(
      // The panel header, inside the frame that clips the panel's content.
      this.panel.locator(":scope > div > header"),
      this.container
    );
    this.webMcpStatus = new WebMcpStatus(this.panel);
    this.logo = new CollapsedLogo(
      this.container.getByRole("button", { name: "Open ayme" })
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
  @ayme.action({
    description: "Expands the panel if it is collapsed to the logo.",
  })
  async open() {
    await this.panel.or(this.logo.root).waitFor();
    if (await this.logo.root.isVisible()) await this.logo.open();
    await this.panel.waitFor();
  }

  @ayme.action({ description: "Collapses the panel to its logo." })
  async collapse() {
    await this.header.collapse();
  }

  /**
   * Selects a tool in the Tools lens and returns its run card. A search in
   * progress is cleared first: its results replace the lens's tree.
   */
  @ayme.action({
    description: "Selects a tool in the Tools lens and opens its run card.",
  })
  async tool(name: string): Promise<RunCard> {
    await this.navigator.showLens("Tools");
    await this.navigator.search("");
    await this.navigator.item(name).click();
    return this.detail.runCard();
  }
}
