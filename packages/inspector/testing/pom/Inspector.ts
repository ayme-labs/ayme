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

/**
 * The Inspector, as a person sees it on the page. It is built from one page
 * object per part of the panel and runs on Playwright and on playwright-lite.
 * Tests drive the panel through it. An app never registers it with the ayme
 * runtime, so its actions never become tools; only a page mounted with
 * `dogfood` does, so agents drive the panel the way tests do.
 */
@ayme
export class Inspector {
  /**
   * @param page a Playwright page with `registerInspectorSelectors` applied,
   *   which reaches into the Inspector's closed shadow root.
   * @param container where the Inspector's container is, when it is not behind the
   *   mount's closed shadow root: a component test renders the panel into an
   *   open root it owns.
   */
  constructor(
    private readonly page: Page,
    private readonly mountedIn?: Locator
  ) {}

  @ayme.child
  get shell(): PanelShell {
    return new PanelShell(this.panel);
  }

  @ayme.child
  get header(): InspectorHeader {
    return new InspectorHeader(
      // The panel header, inside the frame that clips the panel's content.
      this.panel.locator(":scope > div > header"),
      this.container
    );
  }

  @ayme.child
  get logo(): CollapsedLogo {
    return new CollapsedLogo(
      this.container.getByRole("button", { name: "Open ayme" })
    );
  }

  @ayme.child
  get navigator(): Navigator {
    return new Navigator(
      this.panel.getByRole("navigation", { name: "Navigator" })
    );
  }

  @ayme.child
  get detail(): DetailPane {
    return new DetailPane(this.panel.getByRole("region", { name: "Selected" }));
  }

  @ayme.child
  get runs(): RunsView {
    return new RunsView(this.panel.getByRole("region", { name: "Runs" }));
  }

  /** The Structure lens's tree, in the navigator. */
  @ayme.child
  get structure(): StructureLens {
    return new StructureLens(this.navigator.root);
  }

  /**
   * The Inspector's themed container inside its shadow root. Not `root`: a
   * Page Object Root must be visible for its tools to be live, and this
   * element has no size of its own.
   */
  get container(): Locator {
    return (
      this.mountedIn ??
      this.page.locator(
        `${INSPECTOR_SELECTOR_ENGINE}=[data-ayme-inspector-root]`
      )
    );
  }

  /** The expanded panel. */
  @ayme.child
  get panel(): Locator {
    return this.container.getByRole("complementary", {
      name: "ayme",
      exact: true,
    });
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
