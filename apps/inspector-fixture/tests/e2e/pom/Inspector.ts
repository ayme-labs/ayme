import type { Locator, Screen } from "e2e";

import type { On, Tab } from "../tab";

// The Inspector's Page Objects on e2e's `screen`, for the e2e suite: copies
// of the parts of `@ayme-dev/inspector/testing` the suite uses, which that
// entry writes on Playwright. e2e's web engine reads the Inspector's closed
// shadow root itself, so they need no selector engine. Each takes the `Tab`
// it lives in, and hands out locators as `On`, which bring that tab forward.

export type LensName = "Model" | "Structure" | "Tools";

const panelOf = (screen: Screen) => screen.getByRole("complementary", "ayme");

/** The Structure lens's tree, in the navigator. */
export class StructureLens {
  constructor(
    private readonly tab: Tab,
    private readonly navigator: (screen: Screen) => Locator
  ) {}

  private tree(screen: Screen) {
    return this.navigator(screen).getByRole("tree", "Page structure");
  }

  /** The node tagged with a Page Object member, e.g. "ListPage.addItemButton". */
  nodeOf(member: string): On {
    // The tag carries the full member as its title, on an element with no
    // role; e2e has no `getByTitle`.
    const tag = this.tab.browser.locator(
      `[data-member-tag][title=${JSON.stringify(member)}]`
    );
    return this.tab.on((screen) =>
      this.tree(screen).getByRole("treeitem").filter({ has: tag })
    );
  }
}

/** The navigator: search, the lens switcher and the active lens's tree. */
export class Navigator {
  readonly structure: StructureLens;

  constructor(
    private readonly tab: Tab,
    private readonly root: (screen: Screen) => Locator
  ) {
    this.structure = new StructureLens(tab, root);
  }

  get searchBox(): On {
    return this.tab.on((screen) => this.root(screen).getByRole("searchbox"));
  }

  async showLens(name: LensName) {
    await this.tab
      .on((screen) =>
        this.root(screen).getByRole("group", "Lens").getByRole("button", name)
      )
      .click();
  }
}

/** A structure node's view in the detail pane. */
export class NodeView {
  constructor(
    private readonly tab: Tab,
    private readonly root: (screen: Screen) => Locator
  ) {}

  /** The run slot of one single-element tool the node offers, by the tool's name. */
  tool(name: string): On {
    return this.tab.on((screen) =>
      this.root(screen).getByRole("region", "Tools").getByRole("group", name)
    );
  }
}

/** The detail pane: the view of what's selected. */
export class DetailPane {
  readonly node: NodeView;

  constructor(tab: Tab, root: (screen: Screen) => Locator) {
    this.node = new NodeView(tab, root);
  }
}

export class Inspector {
  readonly navigator: Navigator;
  /** The Structure lens's tree, in the navigator. */
  readonly structure: StructureLens;
  readonly detail: DetailPane;

  constructor(private readonly tab: Tab) {
    this.navigator = new Navigator(tab, (screen) =>
      panelOf(screen).getByRole("navigation", "Navigator")
    );
    this.structure = this.navigator.structure;
    this.detail = new DetailPane(tab, (screen) =>
      panelOf(screen).getByRole("region", "Selected")
    );
  }

  /** Expands the panel if it is collapsed to the logo. */
  async open() {
    await this.tab.front();
    const { screen } = this.tab;
    const logo = screen.getByRole("button", "Open ayme");
    await panelOf(screen).or(logo).waitFor();
    if (await logo.isVisible()) await logo.click();
    await panelOf(screen).waitFor();
  }
}
