import type { Locator, Screen } from "e2e";

import type { On, Tab } from "../tab";

// The Inspector's Page Objects on e2e's `screen`, for the e2e suite: copies
// of the parts of `@ayme-dev/inspector/testing` the suite uses, which that
// entry writes on Playwright. e2e's web engine reads the Inspector's closed
// shadow root itself, so they need no selector engine. Each takes the `Tab`
// it lives in, and hands out locators as `On`, which bring that tab forward.
// Where the Playwright Page Objects step through CSS, these query by role,
// name or label, and fall back to `Tab.css` only where nothing else tells
// the parts apart.

export type LensName = "Model" | "Structure" | "Tools";

/** Where a part is on its tab's screen. */
type Root = (screen: Screen) => Locator;

/** A part of the Inspector, anchored at its root on one tab. */
abstract class Part {
  constructor(
    protected readonly tab: Tab,
    protected readonly root: Root
  ) {}

  /** A locator inside this part. */
  protected on(query: (root: Locator) => Locator): On {
    return this.tab.on((screen) => query(this.root(screen)));
  }

  /** A part inside this one. */
  protected inside(query: (root: Locator) => Locator): Root {
    return (screen) => query(this.root(screen));
  }
}

const panelOf: Root = (screen) => screen.getByRole("complementary", "ayme");

/**
 * The text of the first element `selector` matches inside the Inspector, as
 * the DOM has it, line breaks and indentation included: e2e's text reads
 * collapse whitespace. It reads through the hook the Inspector's mount keeps
 * for tests, the closed root on its host under
 * `Symbol.for("@ayme-dev/inspector/shadow-root")`
 * (`packages/inspector/src/shared/infrastructure/shadowRootHook.ts`), which
 * Playwright's `ayme-inspector=` selector engine reads too.
 */
async function panelText(tab: Tab, selector: string): Promise<string | null> {
  await tab.front();
  return tab.browser.evaluate((selector: string) => {
    const key = Symbol.for("@ayme-dev/inspector/shadow-root");
    for (const host of document.querySelectorAll(
      "[data-ayme-inspector-host]"
    )) {
      const root = (host as unknown as Record<symbol, ShadowRoot | undefined>)[
        key
      ];
      const match = root?.querySelector(selector);
      if (match) return match.textContent;
    }
    return null;
  }, selector);
}

/** The Structure lens's tree, in the navigator. */
export class StructureLens extends Part {
  private tree(root: Locator) {
    return root.getByRole("tree", "Page structure");
  }

  /** The node tagged with a Page Object member, e.g. "ListPage.addItemButton". */
  nodeOf(member: string): On {
    // The tag carries the full member as its title, on an element with no
    // role; e2e has no `getByTitle`.
    const tag = this.tab.browser.locator(
      `[data-member-tag][title=${JSON.stringify(member)}]`
    );
    return this.on((root) =>
      this.tree(root).getByRole("treeitem").filter({ has: tag })
    );
  }

  /** A node by its role and name, e.g. ("checkbox", "Urgent"). */
  nodeNamed(role: string, name: string): On {
    return this.on((root) =>
      this.tree(root).getByRole("treeitem", {
        name: new RegExp(`^e\\d+ ${role} ${JSON.stringify(name)}`),
      })
    );
  }
}

export type ModelPaneName = "On this page" | "Page object models";

/**
 * The Model lens's tree in the navigator: the Page Objects on this page and
 * the Page Object Models the page knows, in two collapsible panes.
 */
export class ModelLens extends Part {
  /** The object tree, "On this page". */
  get objectTree(): On {
    return this.on((root) => root.getByRole("tree", "Page objects"));
  }

  /** The Page Object Model list, "Page object models". */
  get modelList(): On {
    return this.on((root) => root.getByRole("list", "Page object models"));
  }

  /** The button that collapses or expands a pane. */
  paneToggle(name: ModelPaneName): On {
    return this.on((root) =>
      root
        .getByRole("region", name)
        .getByRole("button", { name: new RegExp(`^${name} · \\d+$`) })
    );
  }

  async togglePane(name: ModelPaneName) {
    await this.paneToggle(name).click();
  }

  /** An object in the tree, by its path, e.g. "ListPage.items[1]". */
  object(path: string): On {
    return this.on((root) =>
      root.getByRole("tree", "Page objects").getByRole("treeitem", path)
    );
  }

  /** The class names in the model list, in order. */
  async modelNames(): Promise<string[]> {
    const models = await (
      await this.modelList.within((list) => list.getByRole("button")).front()
    ).all();
    const names = [];
    for (const model of models)
      names.push(await model.getAttribute("aria-label"));
    return names.map((name) => name ?? "");
  }
}

/** The navigator: search, the lens switcher and the active lens's tree. */
export class Navigator extends Part {
  readonly structure = new StructureLens(this.tab, this.root);
  readonly model = new ModelLens(this.tab, this.root);

  get searchBox(): On {
    return this.on((root) => root.getByRole("searchbox"));
  }

  /** An item of the active lens's tree, by its text. */
  item(text: string): On {
    return this.on((root) => root.getByRole("button", text));
  }

  async showLens(name: LensName) {
    await this.on((root) =>
      root.getByRole("group", "Lens").getByRole("button", name)
    ).click();
  }

  async search(query: string) {
    await this.searchBox.fill(query);
  }
}

/**
 * "What the model sees" in a detail view: a structure node's page state and
 * the Page Object definitions an agent receives. It starts collapsed.
 */
export class WhatTheModelSees extends Part {
  constructor(tab: Tab, scope: Root) {
    super(tab, (screen) =>
      scope(screen).getByRole("region", "What the model sees")
    );
  }

  get toggle(): On {
    return this.on((root) =>
      root.getByRole("button", { name: /^What the model sees/ })
    );
  }

  /** The Page Object definitions, as snapshot renders them. */
  get definitions(): On {
    return this.on((root) => root.getByLabel("Page object definitions"));
  }

  /** The Page Object definitions' text, line by line as the panel shows it. */
  definitionsText(): Promise<string | null> {
    return panelText(this.tab, 'pre[aria-label="Page object definitions"]');
  }

  /** The page state's text, line by line as the panel shows it. */
  pageStateText(): Promise<string | null> {
    return panelText(this.tab, '[aria-label="Page state"]');
  }

  /** A structure node's own lines of the page state, without its children. */
  get pageState(): On {
    return this.on((root) => root.getByLabel("Page state"));
  }

  async open() {
    if ((await this.toggle.getAttribute("aria-expanded")) !== "true")
      await this.toggle.click();
  }
}

/** A value for one argument, as a person would enter it. */
export type ArgumentValue = string | number | boolean;

/**
 * A run card's ref field: it chooses a ref from a searchable tree of the
 * page's structure, or by pointing at the page. A card has one ref field.
 */
export class RefField extends Part {
  constructor(
    tab: Tab,
    card: Root,
    private readonly path: string
  ) {
    super(tab, card);
  }

  /** Shows the ref chosen, e.g. `e6 button "Add item"`, and opens the tree. */
  get chooser(): On {
    return this.on((card) => card.getByRole("button", this.path));
  }

  /** The crosshair: picks a ref by pointing at the page. */
  get pickButton(): On {
    return this.on((card) =>
      card.getByRole("button", "Pick an element on the page")
    );
  }

  get search(): On {
    return this.on((card) =>
      card.getByRole("textbox", "Search the page structure")
    );
  }

  /** The tree's nodes, each read as its ref, role and name. */
  get nodes(): On {
    return this.on((card) =>
      card.getByRole("tree", "Page structure").getByRole("treeitem")
    );
  }

  /** The ref chosen, as the field shows it, e.g. `e6 button "Add item"`. */
  async value(): Promise<string | undefined> {
    const text = await this.chooser.textContent();
    return text === "Choose an element" ? undefined : (text ?? undefined);
  }

  /** A node of the tree, by its ref, e.g. "e6". */
  node(ref: string): On {
    return this.nodes.within((nodes) =>
      nodes.filter({ hasText: new RegExp(`^${ref}(?!\\d)`) })
    );
  }

  /** A node of the tree, by its role and name, e.g. button "Add item". */
  nodeNamed(role: string, name: string): On {
    const escape = (text: string) =>
      text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // e2e reads rendered text, which may space the ref, role and name apart.
    const text = `^e\\d+ ?${escape(role)} ?${escape(JSON.stringify(name))}$`;
    return this.nodes.within((nodes) =>
      nodes.filter({ hasText: new RegExp(text) })
    );
  }

  /** Opens the tree, when it's closed. */
  async open() {
    if ((await this.chooser.getAttribute("aria-expanded")) !== "true")
      await this.chooser.click();
  }

  /** Searches the tree. */
  async find(query: string) {
    await this.open();
    await this.search.fill(query);
  }

  /** Chooses a ref from the tree. */
  async choose(ref: string) {
    await this.find(ref);
    await this.node(ref).click();
  }

  /**
   * Starts picking on the page; the next click on the page picks. Picking
   * reads the panel's look at the page, so it waits for the structure first.
   */
  async pickOnPage() {
    if ((await this.pickButton.getAttribute("aria-pressed")) === "true") return;
    await this.open();
    await (await this.nodes.within((nodes) => nodes.first()).front()).waitFor();
    await this.pickButton.click();
  }

  /** Whether it's picking on the page. */
  async isPicking() {
    return (await this.pickButton.getAttribute("aria-pressed")) === "true";
  }
}

/**
 * The run card: runs one tool. Run is always there; when the tool needs
 * input, the first press opens the typed form.
 */
export class RunCard extends Part {
  get runButton(): On {
    return this.on((root) => root.getByRole("button", "Run"));
  }

  /** Shows or hides the form, on a card with a head. */
  get argumentsToggle(): On {
    return this.on((root) =>
      root.getByRole("button", { name: /^(Show|Hide) the arguments for / })
    );
  }

  /** The control of one argument, by its path, e.g. "text". */
  field(path: string): On {
    return this.on((root) => root.getByLabel(path));
  }

  /** A ref argument's field, by its path, e.g. "ref". */
  refField(path = "ref"): RefField {
    return new RefField(this.tab, this.root, path);
  }

  /** The items a rooted action can run on. */
  get items(): On {
    return this.on((root) =>
      root.getByRole("radiogroup", "Instance").getByRole("radio")
    );
  }

  /** Opens the form, on a card whose form is closed. */
  async openArguments() {
    if (
      (await this.argumentsToggle.count()) &&
      (await this.argumentsToggle.getAttribute("aria-expanded")) === "false"
    )
      await this.argumentsToggle.click();
  }

  /** Fills the typed form with the given arguments, by name. */
  async fill(args: Readonly<Record<string, ArgumentValue>>) {
    await this.openArguments();
    for (const [path, value] of Object.entries(args)) {
      const field = this.field(path);
      if (typeof value === "boolean") {
        if (value) await field.check();
        else await (await field.front()).uncheck();
      } else if (
        await this.on((root) => root.getByRole("combobox", path)).count()
      )
        await (await field.front()).selectOption(String(value));
      else await field.fill(String(value));
    }
  }

  /** Chooses the item a rooted action runs on, by what it shows. */
  async pickItem(label: string) {
    await this.items
      .within((items) => items.filter({ hasText: label }))
      .click();
  }

  /** Fills the arguments, picks the item when given, and runs the tool. */
  async run(
    args: Readonly<Record<string, ArgumentValue>> = {},
    { item }: { item?: string } = {}
  ) {
    await this.fill(args);
    if (item !== undefined) await this.pickItem(item);
    await this.runButton.click();
  }
}

/** A structure node's view in the detail pane. */
export class NodeView extends Part {
  readonly modelSees = new WhatTheModelSees(this.tab, this.root);

  /** The run slot of one single-element tool the node offers, by the tool's name. */
  tool(name: string): On {
    return this.on((root) =>
      root.getByRole("region", "Tools").getByRole("group", name)
    );
  }

  /** The run card of one single-element tool the node offers. */
  runCard(name: string): RunCard {
    return new RunCard(
      this.tab,
      this.inside((root) =>
        root
          .getByRole("region", "Tools")
          .getByRole("group", name)
          .getByRole("form")
      )
    );
  }
}

/** A tool's page in the detail pane: an article named after the tool. */
export class ToolPage extends Part {
  constructor(tab: Tab, detail: Root) {
    super(tab, (screen) => detail(screen).getByRole("article"));
  }

  readonly modelSees = new WhatTheModelSees(this.tab, this.root);
  readonly card = new RunCard(
    this.tab,
    this.inside((root) => root.getByRole("form"))
  );

  /** Its description's text, or "" for a tool without one. */
  async descriptionText(): Promise<string> {
    // The paragraph directly in the page: the cards hold paragraphs too.
    const description = this.tab.css("article[data-tool-page] > p");
    return (await description.count())
      ? ((await description.textContent()) ?? "")
      : "";
  }
}

/** The Model lens's detail: the page, a Page Object or a Page Object Model. */
export class ModelDetailView extends Part {
  get title(): On {
    return this.on((root) => root.getByRole("heading", { level: 3 }));
  }

  /** One fact of a member's detail: "Owner", "Declared as", "On the page". */
  fact(term: string): On {
    return this.on((root) =>
      root
        .getByRole("group", term)
        // The `<dd>`. e2e's role type leaves out `definition`, which its
        // engine matches as Playwright does.
        .getByRole("definition" as never)
    );
  }

  /** A member, by name: it highlights while hovered, and selects on click. */
  member(name: string): On {
    return this.on((root) =>
      root.getByRole("region", "Members").getByLabel(name)
    );
  }
}

/** The detail pane: the view of what's selected, with its run cards. */
export class DetailPane extends Part {
  readonly model = new ModelDetailView(this.tab, this.root);
  readonly node = new NodeView(this.tab, this.root);
  readonly toolPage = new ToolPage(this.tab, this.root);

  /** A run card, by its action's name; without one, the view's only card. */
  runCard(action?: string): RunCard {
    return new RunCard(
      this.tab,
      this.inside((root) =>
        action === undefined
          ? root.getByRole("form")
          : root.getByRole("form", action)
      )
    );
  }
}

/** One run in the Runs timeline. */
export class RunEntry {
  constructor(private readonly root: On) {}

  /** Running, Succeeded or Failed. */
  async status() {
    return this.root
      .within((run) =>
        run.getByRole("img", { name: /^(Running|Succeeded|Failed)$/ }).first()
      )
      .getAttribute("aria-label");
  }

  /**
   * Who started it: the icon of one of Ayme's own Callers, by its label,
   * e.g. "Run by you from the Inspector".
   */
  async caller(): Promise<{ icon: string }> {
    const icon = this.root.within((run) =>
      run.getByRole("img", { name: /^Run by / }).first()
    );
    return { icon: (await icon.getAttribute("aria-label")) ?? "" };
  }
}

/** Runs: the timeline of the page's Runs, by any Caller, newest first. */
export class RunsView extends Part {
  /** The newest top-level run of one tool. */
  latest(toolName: string): RunEntry {
    // Top-level: the timeline's own items, not the child runs nested in
    // them, which no role or name tells apart.
    return new RunEntry(
      this.tab
        .css(
          `[aria-label="Runs timeline"] > li[aria-label=${JSON.stringify(toolName)}]`
        )
        .within((runs) => runs.first())
    );
  }
}

/** The panel's header. */
export class InspectorHeader extends Part {
  get title(): On {
    return this.on((root) => root.getByRole("heading", "ayme"));
  }
}

export class Inspector {
  readonly header: InspectorHeader;
  readonly navigator: Navigator;
  /** The Structure lens's tree, in the navigator. */
  readonly structure: StructureLens;
  readonly detail: DetailPane;
  readonly runs: RunsView;

  constructor(private readonly tab: Tab) {
    this.header = new InspectorHeader(tab, panelOf);
    this.navigator = new Navigator(tab, (screen) =>
      panelOf(screen).getByRole("navigation", "Navigator")
    );
    this.structure = this.navigator.structure;
    this.detail = new DetailPane(tab, (screen) =>
      panelOf(screen).getByRole("region", "Selected")
    );
    this.runs = new RunsView(tab, (screen) =>
      panelOf(screen).getByRole("region", "Runs")
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

  /**
   * Selects a tool in the Tools lens and returns its run card. A search in
   * progress is cleared first: its results replace the lens's tree.
   */
  async tool(name: string): Promise<RunCard> {
    await this.navigator.showLens("Tools");
    await this.navigator.search("");
    await this.navigator.item(name).click();
    return this.detail.runCard();
  }
}
