import { expect, type Locator, type Screen } from "e2e";

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
 * The text of every element `selector` matches inside the Inspector, as the
 * DOM has it: e2e's text reads give the rendered text, which collapses
 * whitespace and spaces apart the pieces of a qualified name such as
 * `ListPage.addItem`. It reads through the hook the Inspector's mount keeps
 * for tests, the closed root on its host under
 * `Symbol.for("@ayme-dev/inspector/shadow-root")`
 * (`packages/inspector/src/shared/infrastructure/shadowRootHook.ts`), which
 * Playwright's `ayme-inspector=` selector engine reads too.
 */
async function panelTexts(tab: Tab, selector: string): Promise<string[]> {
  await tab.front();
  return tab.browser.evaluate((selector: string) => {
    const key = Symbol.for("@ayme-dev/inspector/shadow-root");
    return [...document.querySelectorAll("[data-ayme-inspector-host]")].flatMap(
      (host) => {
        // The dogfood page mounts the Inspector in an open root.
        const root =
          (host as unknown as Record<symbol, ShadowRoot | undefined>)[key] ??
          host.shadowRoot;
        return [...(root?.querySelectorAll(selector) ?? [])].map(
          (match) => match.textContent ?? ""
        );
      }
    );
  }, selector);
}

/**
 * Drags `handle` by a distance in pixels with the mouse. The Playwright Page
 * Objects dispatch pointer events on the handle; e2e's `swipe` moves the real
 * mouse, which the panel's pointer handlers receive the same way.
 */
async function dragBy(handle: On, deltaX: number, deltaY: number, tab: Tab) {
  const box = await (await handle.front()).boundingBox();
  if (!box) throw new Error("The drag handle is not visible.");
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await tab.screen.swipe({
    from,
    to: { x: from.x + deltaX, y: from.y + deltaY },
  });
}

/** Computed styles host CSS would change if it leaked in, of one element inside the Inspector. */
export type Look = Record<string, string>;

/** The computed `look` of the first element `selector` matches inside the Inspector, read through its mount's test hook. */
export async function panelLook(
  tab: Tab,
  selector: string,
  properties: readonly string[]
): Promise<Look | null> {
  await tab.front();
  return tab.browser.evaluate(
    ({ selector, properties }: { selector: string; properties: string[] }) => {
      const key = Symbol.for("@ayme-dev/inspector/shadow-root");
      for (const host of document.querySelectorAll(
        "[data-ayme-inspector-host]"
      )) {
        const match = (
          host as unknown as Record<symbol, ShadowRoot | undefined>
        )[key]?.querySelector(selector);
        if (!match) continue;
        const style = getComputedStyle(match);
        return Object.fromEntries(
          properties.map((name) => [name, style.getPropertyValue(name)])
        );
      }
      return null;
    },
    { selector, properties: [...properties] }
  );
}

/** The text of the first element `selector` matches, as `panelTexts` reads it. */
async function panelText(tab: Tab, selector: string): Promise<string | null> {
  return (await panelTexts(tab, selector))[0] ?? null;
}

/** The Structure lens's tree, in the navigator. */
export class StructureLens extends Part {
  private treeOf(root: Locator) {
    return root.getByRole("tree", "Page structure");
  }

  get tree(): On {
    return this.on((root) => this.treeOf(root));
  }

  /** The tree's text, as the DOM has it. */
  async treeText(): Promise<string> {
    return (
      (await panelText(
        this.tab,
        '[role="tree"][aria-label="Page structure"]'
      )) ?? ""
    );
  }

  /** The node tagged with a Page Object member, e.g. "ListPage.addItemButton". */
  nodeOf(member: string): On {
    // The tag carries the full member as its title, on an element with no
    // role; e2e has no `getByTitle`.
    const tag = this.tab.browser.locator(
      `[data-member-tag][title=${JSON.stringify(member)}]`
    );
    return this.on((root) =>
      this.treeOf(root).getByRole("treeitem").filter({ has: tag })
    );
  }

  /** A node by its role and name, e.g. ("checkbox", "Urgent"). */
  nodeNamed(role: string, name: string): On {
    return this.on((root) =>
      this.treeOf(root).getByRole("treeitem", {
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

/** How the Tools lens labels its groups. */
export type ToolGroupLabel =
  | "Page object tools"
  | "Custom tools"
  | "Browser tools"
  | "Peek tools"
  | "Agent tools";

const toolGroupLabels: readonly ToolGroupLabel[] = [
  "Page object tools",
  "Custom tools",
  "Browser tools",
  "Peek tools",
  "Agent tools",
];

/** The sections of the Peek tools group: the page's and the App Processes'. */
export type PeekSideLabel = "Browser" | "Node";

/** The Tools lens's tree: the live tools, grouped. */
export class ToolsLens extends Part {
  /** A tool's entry, by name. Pressing it opens the tool's page. */
  tool(name: string): On {
    return this.on((root) => root.getByRole("button", name));
  }

  /** A tool's row in its group's list. */
  row(name: string): On {
    return this.on((root) =>
      root
        .getByRole("listitem")
        .filter({ has: this.tab.screen.getByRole("button", name) })
    );
  }

  /** Whether a tool's row shows the destructive icon in place of the tool icon. */
  async markedDestructive(name: string): Promise<boolean> {
    const icon = this.tab.browser.locator("[data-destructive-icon]");
    return (
      (await this.row(name)
        .within((row) => row.filter({ has: icon }))
        .count()) > 0
    );
  }

  /** The Peek tools' names, by the side each row's badge shows. */
  async peekSections(): Promise<Partial<Record<PeekSideLabel, string[]>>> {
    await this.tab.front();
    // Read through the mount's test hook, as `panelTexts` does: a row's name
    // and its badge are two texts e2e would read as one.
    const rows = await this.tab.browser.evaluate(() => {
      const key = Symbol.for("@ayme-dev/inspector/shadow-root");
      return [...document.querySelectorAll("[data-ayme-inspector-host]")]
        .flatMap((host) => {
          const root =
            (host as unknown as Record<symbol, ShadowRoot | undefined>)[key] ??
            host.shadowRoot;
          return [
            ...(root?.querySelectorAll('[aria-label="Peek tools"] > li') ?? []),
          ];
        })
        .map((item) => ({
          name: item.querySelector("button")?.textContent ?? "",
          side: item.querySelector("[data-peek-side]")?.textContent ?? "",
        }));
    });
    const sections: Partial<Record<PeekSideLabel, string[]>> = {};
    for (const { name, side } of rows)
      (sections[side as PeekSideLabel] ??= []).push(name);
    return sections;
  }

  /** The listed tools' names, by group, for the groups that list any. */
  async listed(): Promise<Partial<Record<ToolGroupLabel, string[]>>> {
    const listed: Partial<Record<ToolGroupLabel, string[]>> = {};
    for (const label of toolGroupLabels) {
      // The group's own list in the navigator, as the Playwright Page
      // Object reads it.
      const names = await panelTexts(
        this.tab,
        `nav[aria-label="Navigator"] ul[aria-label=${JSON.stringify(label)}] > li button`
      );
      if (names.length > 0) listed[label] = names;
    }
    return listed;
  }
}

/** The navigator: search, the lens switcher and the active lens's tree. */
export class Navigator extends Part {
  get tools(): ToolsLens {
    return new ToolsLens(this.tab, this.root);
  }

  get structure(): StructureLens {
    return new StructureLens(this.tab, this.root);
  }

  get model(): ModelLens {
    return new ModelLens(this.tab, this.root);
  }

  /** The legend's counts: live, not on page, refs. */
  get legend(): On {
    return this.on((root) => root.getByRole("group", "Legend"));
  }

  get searchBox(): On {
    return this.on((root) => root.getByRole("searchbox"));
  }

  /** A search result, by its label. */
  result(label: string): On {
    return this.on((root) =>
      root
        .getByRole("list", "Search results")
        .getByRole("button")
        .filter({ hasText: label })
    );
  }

  /** An item of the active lens's tree, by its text. */
  item(text: string): On {
    return this.on((root) => root.getByRole("button", text));
  }

  lens(name: LensName): On {
    return this.on((root) =>
      root.getByRole("group", "Lens").getByRole("button", name)
    );
  }

  get searchResults(): On {
    return this.on((root) =>
      root.getByRole("list", "Search results").getByRole("button")
    );
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
/**
 * What the model sees of the selected detail, as CSS for the mount's hook:
 * a tool page and a structure node each have one, in the Selected region.
 */
const inModelSees =
  'section[aria-label="Selected"] section[aria-label="What the model sees"]';

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
    return panelText(
      this.tab,
      `${inModelSees} pre[aria-label="Page object definitions"]`
    );
  }

  /**
   * A tool's input schema, parsed from what the block shows. It waits for
   * the block, as the Playwright Page Object's `textContent()` does.
   */
  async schemaValue(toolName: string): Promise<unknown> {
    const label = JSON.stringify(`${toolName} input schema`);
    const read = () =>
      panelText(this.tab, `${inModelSees} pre[aria-label=${label}]`);
    await expect.poll(read).not.toBeNull();
    return JSON.parse((await read()) ?? "");
  }

  /** The page state's text, line by line as the panel shows it. */
  pageStateText(): Promise<string | null> {
    return panelText(this.tab, `${inModelSees} [aria-label="Page state"]`);
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

/** `fill_form`'s form: one row per field to fill. */
export class FillForm extends Part {
  control(name: string): On {
    return this.on((list) => list.getByRole("listitem").getByLabel(name));
  }

  /** Sets a field: text for a textbox, a checked state for a checkbox. */
  async set(name: string, value: string | boolean) {
    const control = this.control(name);
    if (typeof value === "string") await control.fill(value);
    else if (value) await control.check();
    else await (await control.front()).uncheck();
  }

  /** Undoes the change to one field. */
  async undo(name: string) {
    await this.on((list) =>
      list.getByRole("button", `Undo the change to ${name}`)
    ).click();
  }
}

/** A run card's key field: Esc switches it from recording a key press to searching key names. */
export class KeyField extends Part {
  constructor(
    tab: Tab,
    card: Root,
    private readonly path: string
  ) {
    super(tab, card);
  }

  get input(): On {
    return this.on((card) => card.getByRole("combobox", this.path));
  }

  get modeButton(): On {
    return this.on((card) =>
      card.getByRole("button", {
        name: /^(Search key names|Record a key press) instead$/,
      })
    );
  }

  /** Switches to searching and types a key name, e.g. "F2". */
  async search(text: string) {
    await this.input.click();
    // Recording now: Esc switches it to searching.
    if (
      (await this.modeButton.getAttribute("aria-label")) ===
      "Search key names instead"
    )
      await this.tab.browser.keyboard.press("Escape");
    await this.input.fill(text);
  }
}

/** `generate_locator`'s groups of targets, each with the locators a run gave them. */
export class LocatorGroups extends Part {
  private group(number: number) {
    return (groups: Locator) => groups.getByRole("listitem", `Group ${number}`);
  }

  /** The locator the last run gave a target. */
  locator(number: number, ref: string): On {
    return this.on((groups) =>
      this.group(number)(groups).getByLabel(`Locator for ${ref}`)
    );
  }

  /** Adds targets from a group's tree, or removes ones it has, by ref. */
  async toggleFromTree(number: number, ...refs: string[]) {
    const treeButton = this.on((groups) =>
      this.group(number)(groups).getByRole("button", "Add from tree")
    );
    if ((await treeButton.getAttribute("aria-expanded")) !== "true")
      await treeButton.click();
    for (const ref of refs)
      await this.on((groups) =>
        this.group(number)(groups)
          .getByRole("tree", `Add targets to group ${number}`)
          .getByRole("treeitem")
          .filter({ hasText: new RegExp(`^${ref}(?!\\d)`) })
      ).click();
  }
}

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

  get jsonSwitch(): On {
    return this.on((root) =>
      root.getByRole("group", "Arguments editor").getByRole("button", "JSON")
    );
  }

  get formSwitch(): On {
    return this.on((root) =>
      root.getByRole("group", "Arguments editor").getByRole("button", "Form")
    );
  }

  /** The control of one argument, by its path, e.g. "text". */
  field(path: string): On {
    return this.on((root) => root.getByLabel(path));
  }

  /** Why the session would refuse a call now, under the tool's name. */
  get reason(): On {
    return this.on((root) =>
      // e2e's Role type leaves out `note`, which its engine matches.
      root.getByRole("note" as never, "Why it is unavailable")
    );
  }

  /** A key argument's field, by its path, e.g. "key". */
  keyField(path = "key"): KeyField {
    return new KeyField(this.tab, this.root, path);
  }

  /** `generate_locator`'s groups. */
  get locatorGroups(): LocatorGroups {
    return new LocatorGroups(
      this.tab,
      this.inside((card) => card.getByRole("list", "Locator groups"))
    );
  }

  /** `fill_form`'s form. */
  get fillForm(): FillForm {
    return new FillForm(
      this.tab,
      this.inside((card) => card.getByRole("list", "Form fields"))
    );
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
      if ((await field.getAttribute("aria-haspopup")) === "tree") {
        await this.refField(path).choose(String(value));
        continue;
      }
      // A key field is a combobox of its own; a select's role is implicit.
      if ((await field.getAttribute("role")) === "combobox") {
        await this.keyField(path).search(String(value));
        continue;
      }
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
  get modelSees(): WhatTheModelSees {
    return new WhatTheModelSees(this.tab, this.root);
  }

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

  get modelSees(): WhatTheModelSees {
    return new WhatTheModelSees(this.tab, this.root);
  }

  get card(): RunCard {
    return new RunCard(
      this.tab,
      this.inside((root) => root.getByRole("form"))
    );
  }

  /** The tool's name. */
  get title(): On {
    return this.on((root) => root.getByRole("heading", { level: 2 }));
  }

  /** The mark beside its name of a tool marked destructive. */
  get destructiveMark(): On {
    // Beside the name only: the run card has a mark of its own.
    return this.tab.css(
      "article[data-tool-page] > div:first-child > [data-destructive-mark]"
    );
  }

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
  get model(): ModelDetailView {
    return new ModelDetailView(this.tab, this.root);
  }

  get node(): NodeView {
    return new NodeView(this.tab, this.root);
  }

  get toolPage(): ToolPage {
    return new ToolPage(this.tab, this.root);
  }

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

/** One Interaction of a run: a call it made on the page. */
export type RunInteraction = {
  operation: string;
  /** The member it acted on, or else its locator. */
  target: string;
  value?: string;
};

/** What a run's card shows, read at once and as the DOM has it. */
export type RunSnapshot = {
  status: string | null;
  caller: { icon: string } | { text: string } | null;
  /** The toggle's text: what the run ran, on what. */
  toggle: string;
  /** Whether the toggle marks its target gone from the page. */
  targetGone: boolean;
  /** Its arguments, as JSON; null when it had none. */
  arguments: string | null;
  interactions: RunInteraction[];
  error: string | null;
  /** Its result, while shown. */
  result: string | null;
  /** Whether it ran before the page last loaded. */
  earlierPage: boolean;
  /** The tools of the runs it started, in order. */
  childTools: string[];
};

/** Which match of a run's CSS path is the run. */
type Pick = "first" | "last";

/**
 * Reads one run's card through the Inspector mount's test hook (see
 * `panelTexts`): the Playwright Page Objects read these parts with
 * `evaluate` and DOM text, which e2e's locators do not give.
 */
/**
 * One step from the timeline to a run: the CSS that matches it and which
 * match to take. A step after the first matches only the runs its previous
 * step's run started.
 */
type RunStep = { selector: string; pick: Pick };

async function readRun(
  tab: Tab,
  steps: readonly RunStep[]
): Promise<RunSnapshot | null> {
  await tab.front();
  // As a JSON string: e2e's evaluate types its result as JSON, and a
  // snapshot's optional parts don't fit that type.
  const json = await tab.browser.evaluate(
    (steps: RunStep[]) => {
      const key = Symbol.for("@ayme-dev/inspector/shadow-root");
      const [first, ...rest] = steps;
      const roots = [
        ...document.querySelectorAll("[data-ayme-inspector-host]"),
      ].flatMap((host) => {
        const root = (
          host as unknown as Record<symbol, ShadowRoot | undefined>
        )[key];
        return root ? [root] : [];
      });
      const take = (matches: Element[], pick: Pick) =>
        pick === "first" ? matches[0] : matches.at(-1);
      let run = take(
        roots.flatMap((root) => [...root.querySelectorAll(first!.selector)]),
        first!.pick
      );
      for (const step of rest) {
        const parent = run;
        // The runs this one started, not those its children started.
        run = take(
          [...(parent?.querySelectorAll(step.selector) ?? [])].filter(
            (child) => child.parentElement?.closest("li") === parent
          ),
          step.pick
        );
      }
      // An ancestor comes first in document order: the run's own card.
      const card = run?.querySelector("[data-run-card]");
      if (!run || !card) return "null";
      const text = (element: Element | null | undefined) =>
        element ? (element.textContent ?? "") : null;
      const toggle = card.querySelector("button[aria-expanded]");
      const callerMark = card.querySelector('[title^="Run by "]');
      const childRuns = run.querySelector('[aria-label="Child runs"]');
      return JSON.stringify({
        status:
          run
            .querySelector(
              '[role="img"][aria-label="Running"], [role="img"][aria-label="Succeeded"], [role="img"][aria-label="Failed"]'
            )
            ?.getAttribute("aria-label") ?? null,
        caller: callerMark
          ? callerMark.getAttribute("role") === "img"
            ? { icon: callerMark.getAttribute("aria-label") ?? "" }
            : { text: callerMark.textContent ?? "" }
          : null,
        toggle: text(toggle) ?? "",
        targetGone:
          toggle
            ?.querySelector('[title^="Not available to highlight:"]')
            ?.getAttribute("data-gone") === "true",
        arguments: text(card.querySelector('figure[aria-label="Arguments"]')),
        interactions: [
          ...card.querySelectorAll('ol[aria-label="Interactions"] > li'),
        ].map((item) => {
          const [operation = "", value] = [
            ...item.querySelectorAll(":scope > span"),
          ].map((span) => span.textContent ?? "");
          return {
            operation,
            target: item.querySelector("button")?.textContent ?? "",
            ...(value === undefined ? {} : { value }),
          };
        }),
        error: text(card.querySelector('[role="note"][aria-label="Error"]')),
        result: text(card.querySelector('figure[aria-label="Result"]')),
        earlierPage: [...card.querySelectorAll("*")].some(
          (element) => element.textContent === "Earlier page"
        ),
        childTools: [...(childRuns?.querySelectorAll(":scope > li") ?? [])].map(
          (item) => item.getAttribute("aria-label") ?? ""
        ),
      });
    },
    [...steps]
  );
  return JSON.parse(json) as RunSnapshot | null;
}

/**
 * One run in the Runs timeline, top-level or nested under the run that
 * started it, by its CSS path in the panel: the parts that tell runs apart
 * (a list's own items, a run's own card) have no role or name.
 */
export class RunEntry {
  constructor(
    private readonly tab: Tab,
    private readonly steps: readonly RunStep[],
    /** The run's element, for pressing or hovering something in it. */
    private readonly root: On
  ) {}

  /** What its card shows now, or null while it is not in the timeline. */
  read(): Promise<RunSnapshot | null> {
    return readRun(this.tab, this.steps);
  }

  /** Running, Succeeded or Failed. */
  async status() {
    return (await this.read())?.status ?? null;
  }

  /** Who started it: a built-in Caller's icon label, or another Caller's name. */
  async caller() {
    return (await this.read())?.caller ?? null;
  }

  /** Its own Interactions, in order. */
  async interactionList(): Promise<RunInteraction[]> {
    return (await this.read())?.interactions ?? [];
  }

  /** Its child runs' tools, in the order it started them. */
  async childTools(): Promise<string[]> {
    return (await this.read())?.childTools ?? [];
  }

  /** What an Interaction acted on; hovering it highlights that element. */
  interactionTarget(index: number): On {
    return this.root.within((run) =>
      run
        .getByRole("list", "Interactions")
        .first()
        .getByRole("listitem")
        .nth(index)
        .getByRole("button")
    );
  }

  /** Shows or hides its result, on a successful run that returned one. */
  /** Copies its result. */
  get copyResultButton(): On {
    return this.root.within((run) => run.getByRole("button", "Copy").first());
  }

  get resultToggle(): On {
    return this.root.within((run) => run.getByRole("button", "Result").first());
  }

  /** Its result as Runs shows it, opened first if it isn't. */
  async resultText() {
    if ((await this.resultToggle.getAttribute("aria-expanded")) === "false")
      await this.resultToggle.click();
    return (await this.read())?.result ?? null;
  }

  /** The newest child run of one tool, among the runs this one started. */
  child(toolName: string): RunEntry {
    return new RunEntry(
      this.tab,
      [
        ...this.steps,
        {
          selector: `[aria-label="Child runs"] > li[aria-label=${JSON.stringify(toolName)}]`,
          pick: "last",
        },
      ],
      this.root.within((run) =>
        run
          .getByRole("list", "Child runs")
          .first()
          .getByRole("listitem", toolName)
          .last()
      )
    );
  }
}

/** Runs: the timeline of the page's Runs, by any Caller, newest first. */
export class RunsView extends Part {
  /** The runs shown, newest first. */
  get runs(): On {
    return this.tab.css('[aria-label="Runs timeline"] > li');
  }

  /** The newest top-level run of one tool. */
  latest(toolName: string): RunEntry {
    const selector = `[aria-label="Runs timeline"] > li[aria-label=${JSON.stringify(toolName)}]`;
    return new RunEntry(
      this.tab,
      [{ selector, pick: "first" }],
      this.tab.css(selector).within((runs) => runs.first())
    );
  }

  get clearButton(): On {
    return this.on((root) => root.getByRole("button", "Clear"));
  }

  async clear() {
    await this.clearButton.click();
  }

  /** Shows the selection's runs, e.g. "This object". */
  async showSelection() {
    await this.on((root) =>
      root.getByRole("group", "Runs scope").getByRole("button").first()
    ).click();
  }

  /** Shows every run. */
  async showAll() {
    await this.on((root) =>
      root.getByRole("group", "Runs scope").getByRole("button", "All")
    ).click();
  }
}

export type PanelEdge = "left" | "right" | "top" | "bottom";
export type PanelCorner =
  "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** The panel's frame: its box and its resize handles. */
export class PanelShell extends Part {
  resizeHandle(handle: PanelEdge | PanelCorner): On {
    const kind = handle.includes("-") ? "corner" : "edge";
    return this.on((root) =>
      root.getByRole("separator", `Resize from the ${handle} ${kind}`)
    );
  }

  /** Resizes the panel from one edge or corner by a distance in pixels. */
  async resizeBy(
    handle: PanelEdge | PanelCorner,
    deltaX: number,
    deltaY: number
  ) {
    await dragBy(this.resizeHandle(handle), deltaX, deltaY, this.tab);
  }

  async box() {
    const box = await (await this.on((root) => root).front()).boundingBox();
    if (!box) throw new Error("The panel is not visible.");
    return box;
  }
}

export type ThemeChoice = "System" | "Light" | "Dark";
export type LayoutChoice =
  "Floating" | "Dock left" | "Dock right" | "Dock to bottom";

/** The theme switch: System, Light, Dark, in turn. */
export class ThemeSwitch extends Part {
  get button(): On {
    return this.on((root) => root.getByRole("button", { name: /^Theme: / }));
  }

  async current(): Promise<ThemeChoice> {
    const name = (await this.button.getAttribute("aria-label")) ?? "";
    const current = /^Theme: (\w+)\./.exec(name)?.[1];
    if (current !== "System" && current !== "Light" && current !== "Dark")
      throw new Error(`The theme switch reads "${name}".`);
    return current;
  }
}

/** The layout menu: floating, or docked to a side. It opens in the Inspector's portal. */
export class LayoutMenu extends Part {
  get trigger(): On {
    return this.on((root) => root.getByRole("button", { name: /^Layout: / }));
  }

  get menu(): On {
    // Named after its trigger, e.g. "Layout: Floating". Playwright's
    // `{ name: "Layout" }` matches that as a substring, case aside; e2e
    // matches whole names, so the regex says the same.
    return this.tab.on((screen) =>
      screen.getByRole("menu", { name: /layout/i })
    );
  }

  async current(): Promise<LayoutChoice> {
    const name = (await this.trigger.getAttribute("aria-label")) ?? "";
    return name.replace(/^Layout: /, "") as LayoutChoice;
  }

  option(choice: LayoutChoice): On {
    return this.menu.within((menu) => menu.getByRole("menuitemradio", choice));
  }

  async choose(choice: LayoutChoice) {
    await this.trigger.click();
    await this.option(choice).click();
  }
}

/** One row of the Connections popover: how one kind of agent reaches the page. */
export class ConnectionRow {
  constructor(
    private readonly tab: Tab,
    private readonly name: string
  ) {}

  /** The row, a region in the popover. */
  get root(): On {
    return this.tab.on((screen) =>
      screen.getByRole("dialog", "Connections").getByRole("region", this.name)
    );
  }

  /** Its state, e.g. "Published": the last text of its head, with no role of its own. */
  get state(): On {
    return this.tab.css(
      `section[aria-label=${JSON.stringify(this.name)}] > div > span:last-child`
    );
  }
}

/** The Connections pill in the header, and the popover it opens. */
export class Connections extends Part {
  get agent(): ConnectionRow {
    return new ConnectionRow(this.tab, "Agent");
  }

  get webMCP(): ConnectionRow {
    return new ConnectionRow(this.tab, "WebMCP");
  }

  get pill(): On {
    return this.on((root) =>
      root.getByRole("button", { name: /^Connections: / })
    );
  }

  async open() {
    if ((await this.pill.getAttribute("aria-expanded")) !== "true")
      await this.pill.click();
  }
}

/** The panel's header: the title, Connections, the theme, layout and collapse. */
export class InspectorHeader extends Part {
  get connections(): Connections {
    return new Connections(this.tab, this.root);
  }

  get themeSwitch(): ThemeSwitch {
    return new ThemeSwitch(this.tab, this.root);
  }

  get layoutMenu(): LayoutMenu {
    return new LayoutMenu(this.tab, this.root);
  }

  get title(): On {
    return this.on((root) => root.getByRole("heading", "ayme"));
  }

  get collapseButton(): On {
    return this.on((root) => root.getByRole("button", "Collapse inspector"));
  }

  async collapse() {
    await this.collapseButton.click();
  }

  /** Drags the panel by its header. */
  async dragBy(deltaX: number, deltaY: number) {
    await dragBy(this.title, deltaX, deltaY, this.tab);
  }
}

/** The collapsed Inspector: the ayme logo, which opens the panel. */
export class CollapsedLogo {
  constructor(private readonly tab: Tab) {}

  get root(): On {
    return this.tab.on((screen) => screen.getByRole("button", "Open ayme"));
  }

  async open() {
    await this.root.click();
  }
}

export class Inspector {
  constructor(readonly tab: Tab) {}

  get shell(): PanelShell {
    return new PanelShell(this.tab, panelOf);
  }

  get logo(): CollapsedLogo {
    return new CollapsedLogo(this.tab);
  }

  get header(): InspectorHeader {
    return new InspectorHeader(this.tab, panelOf);
  }

  get navigator(): Navigator {
    return new Navigator(this.tab, (screen) =>
      panelOf(screen).getByRole("navigation", "Navigator")
    );
  }

  /** The Structure lens's tree, in the navigator. */
  get structure(): StructureLens {
    return this.navigator.structure;
  }

  get detail(): DetailPane {
    return new DetailPane(this.tab, (screen) =>
      panelOf(screen).getByRole("region", "Selected")
    );
  }

  get runs(): RunsView {
    return new RunsView(this.tab, (screen) =>
      panelOf(screen).getByRole("region", "Runs")
    );
  }

  /** The expanded panel. */
  get panel(): On {
    return this.tab.on(panelOf);
  }

  /**
   * The Inspector's themed container inside its shadow root, which holds
   * the panel and its portal. It has no role or name.
   */
  get container(): On {
    return this.tab.css("[data-ayme-inspector-root]");
  }

  async collapse() {
    await this.header.collapse();
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
