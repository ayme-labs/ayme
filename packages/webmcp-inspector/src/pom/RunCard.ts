import type { Locator } from "@playwright/test";

import { RefField } from "./RefField";

/** A value for one argument, as a person would enter it. */
export type ArgumentValue =
  | string
  | number
  | boolean
  | readonly (string | number)[]
  | { readonly [name: string]: ArgumentValue };

/**
 * The run card: runs one tool. Run is always there; when the tool needs
 * input, the first press opens the typed form.
 */
export class RunCard {
  readonly root: Locator;
  readonly runButton: Locator;
  /** Shows or hides the form, on a card with a head. */
  readonly argumentsToggle: Locator;
  readonly formSwitch: Locator;
  readonly jsonSwitch: Locator;
  readonly jsonEditor: Locator;
  /** Why the JSON editor's arguments can't be used. */
  readonly jsonError: Locator;
  /** The items a collection action can run on. */
  readonly items: Locator;
  /** The last run's status, its duration, and its error. */
  readonly lastResult: Locator;
  readonly payloadToggle: Locator;
  readonly payload: Locator;
  /** Shows the last successful run in Runs. */
  readonly lastSuccessLink: Locator;

  constructor(root: Locator) {
    this.root = root;
    this.runButton = root.getByRole("button", { name: "Run", exact: true });
    this.argumentsToggle = root.getByRole("button", {
      name: /^(Show|Hide) the arguments for /,
    });
    const editor = root.getByRole("group", { name: "Arguments editor" });
    this.formSwitch = editor.getByRole("button", { name: "Form" });
    this.jsonSwitch = editor.getByRole("button", { name: "JSON" });
    this.jsonEditor = root.getByRole("textbox", { name: "Arguments JSON" });
    this.jsonError = root.getByRole("alert");
    this.items = root
      .getByRole("radiogroup", { name: "Item" })
      .getByRole("radio");
    this.lastResult = root.getByRole("status", { name: "Last result" });
    this.payloadToggle = this.lastResult.getByRole("button", {
      name: /^(Show|Hide) payload$/,
    });
    this.payload = this.lastResult.getByRole("figure", { name: "Payload" });
    this.lastSuccessLink = this.lastResult.getByRole("button", {
      name: /^(Show in runs|Last success)/,
    });
  }

  /**
   * The control of one argument, by its path, e.g. "text" or "details.due".
   * A list's entries are "tags 1", "tags 2" and so on.
   */
  field(path: string): Locator {
    return this.root.getByLabel(path, { exact: true });
  }

  /** A ref argument's field, by its path, e.g. "ref". */
  refField(path = "ref"): RefField {
    return new RefField(this.root, path);
  }

  /** Opens the form, on a card whose form is closed. */
  async openArguments() {
    if (
      (await this.argumentsToggle.count()) &&
      (await this.argumentsToggle.getAttribute("aria-expanded")) === "false"
    )
      await this.argumentsToggle.click();
  }

  /** Chooses the item a collection action runs on, by what it shows. */
  async pickItem(label: string) {
    await this.items.filter({ hasText: label }).click();
  }

  /** Fills the typed form with the given arguments. */
  async fill(args: Readonly<Record<string, ArgumentValue>>) {
    await this.openArguments();
    for (const [name, value] of Object.entries(args))
      await this.fillField(name, value);
  }

  /** Types the arguments into the JSON editor. */
  async fillJson(text: string) {
    await this.openArguments();
    await this.jsonSwitch.click();
    await this.jsonEditor.fill(text);
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

  private async fillField(path: string, value: ArgumentValue) {
    if (Array.isArray(value)) {
      for (const [index, entry] of value.entries()) {
        await this.root
          .getByRole("button", { name: `Add to ${path}`, exact: true })
          .click();
        await this.fillField(`${path} ${index + 1}`, entry);
      }
      return;
    }
    const field = this.field(path);
    const kind = (await field.count())
      ? await field.evaluate((element) =>
          element.getAttribute("aria-haspopup") === "tree"
            ? "ref"
            : element instanceof HTMLInputElement
              ? element.type
              : element.tagName.toLowerCase()
        )
      : "none";
    if (kind === "ref") return await this.refField(path).choose(String(value));
    if (typeof value === "object" && kind !== "textarea") {
      // An object: an optional one is switched on, then each entry filled.
      if (kind === "checkbox") await field.setChecked(true);
      for (const [name, entry] of Object.entries(value))
        await this.fillField(`${path}.${name}`, entry);
    } else if (typeof value === "boolean") await field.setChecked(value);
    else if (kind === "select")
      await field.selectOption({ label: String(value) });
    else if (kind === "number" || kind === "email") {
      // playwright-lite's fill assigns these inputs' value directly, which
      // React's controlled input never sees; typing reaches it.
      await field.fill("");
      await field.pressSequentially(String(value));
    } else
      await field.fill(
        typeof value === "object" ? JSON.stringify(value) : String(value)
      );
  }
}
