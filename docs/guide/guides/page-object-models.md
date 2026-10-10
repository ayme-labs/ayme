# Page Object Models

How to mark a Page Object Model and its actions so Ayme turns them into Page Object Tools, how those tools are named, and how Page Object Children become tools too.

## Mark a model and its actions

Keep your Page Object Model as it is. Mark the class with `@ayme` and each action to expose with `@ayme.action`; each marked action becomes a Page Object Tool:

```ts
import { ayme } from "@ayme-dev/ayme";
import type { Page } from "@playwright/test";

@ayme
export class ProjectsPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  @ayme.action({ description: "Create a project with the given name." })
  async createProject(name: string) {
    await this.page.getByRole("button", { name: "New project" }).click();
    await this.page.getByRole("textbox", { name: "Project name" }).fill(name);
    await this.page.getByRole("button", { name: "Create" }).click();
  }
}
```

- Both decorators take an optional description: `@ayme({ description })` describes the model, and a bare `@ayme.action` publishes with a generated description. `@ayme.action` also takes `available`, the action's availability predicate; see [Action availability](#action-availability).
- Only marked actions become tools. Public members are not published on their own.
- A class that extends an `@ayme` class is a Page Object Model too, even without the decorator. Its actions still need `@ayme.action`.
- No Ayme base class is needed, and the same class keeps working in your Playwright tests.

## Where models live

Put marked models in `.ts` files the application imports, with `experimentalDecorators` on; the [build plugin](../reference/build-plugin.md#what-it-compiles) compiles them. They run in the browser, so they use Playwright's types only, as [Playwright in the browser](../reference/playwright-in-the-browser.md) explains.

## Tool names and inputs

A Page Object Tool is named after its class and method: `ProjectsPage.createProject`. Registering a Page Object while a different class with the same name is registered throws; rename one of them.

The tool's input schema comes from the method's signature: an object with one property per parameter, required unless the parameter is optional or has a default value. A literal default, such as `type = "personal"`, is published as the property's `default`. A parameter can take:

| Type                                                          | Schema                                                                                    |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `string`, `number`, `boolean`                                 | `{ type }`                                                                                |
| A union of literals of one type, such as `"a" \| "b"`         | `{ type, enum }`                                                                          |
| An array, `T[]` or `readonly T[]`                             | `{ type: "array", items }`                                                                |
| A tuple, such as `[number, string?]` or `[string, ...T[]]`    | `{ type: "array", prefixItems }`, with `minItems`, and `maxItems` or `items` for the rest |
| An object type made of property signatures                    | `{ type: "object", properties, required }`                                                |
| `Record<string, T>`, or an index signature `[key: string]: T` | `{ type: "object", additionalProperties }`, beside any declared properties                |
| Any other union, such as `string \| boolean`                  | `{ anyOf }`, with `null` as `{ type: "null" }`                                            |

`undefined` in a union makes the parameter optional; `null` does not. A rest parameter, `...refs: string[]`, is a list, optional unless its tuple type has required elements, and the tool's description says to pass its arguments as one. A recursive type is described down to its first repeat, which takes any array or object.

Functions, class instances such as `Date`, object types with methods or getters, `unknown`, `any` and open generics have no schema. An action taking one fails the build naming the parameter, and the build lists an unmarked method taking one; see the [build plugin's report](../reference/build-plugin.md#report).

## Page Object Children

A model can hold other Page Objects as Page Object Children: a field or getter typed as a model holds one, and an async method without parameters that returns an array of a model holds several, a collection. Their actions become tools too, named by the path from the registered model:

```ts
@ayme
export class ListPage {
  readonly archiveDialog: ArchiveDialog; // one Page Object Child

  async items(): Promise<ListItem[]> {
    // several Page Object Children: a collection
    const rows = await this.itemRows.all();
    return rows.map((row) => new ListItem(row, this.archiveDialog));
  }
}

@ayme
export class ListItem {
  readonly root: Locator; // the Page Object Root

  @ayme.action({ description: "Archive this list item." })
  async archive() {
    // ...
  }
}
```

- A collection's actions are published once for all its items: `ListPage.items.archive` takes `{ ref, args }`, where `ref` is the Structural Ref of the item's Page Object Root in the page state and `args` holds the action's own input.
- A single child's actions take their input directly: a marked `confirm` on `ArchiveDialog` would be `ListPage.archiveDialog.confirm`.

## The Page Object Root

A `root` locator member is the model's Page Object Root: the element that anchors the instance in the page. It decides whether the Page Object is present, while the root is on the page, and whether it is available, while a click would also reach the root; the page state labels that element with the Page Object's name. A child's tools are listed only while its root is on the page, so a child needs a `root`. A registered top-level model without one has tools that are listed as long as it is registered.

Presence lists tools; availability says whether they would run. A present Page Object whose root a click would not reach, such as one under an open dialog, keeps its tools listed, flagged unavailable with a reason that names what is in the way, and a call is refused with that reason. [`ayme.tools`](../reference/ayme.md#aymetools) has the form of the reason.

## Action availability

An action that is possible only in some states, such as removing a dashboard that is not built in, declares when it can run with `available`: an availability predicate that gets the live Page Object and answers `true`, `false`, or a string that says why not. The action keeps its natural Page Object, and the tool stays listed either way:

```ts
const canRemove = async (self: SettingsPanel) =>
  (await self.removeButton.isVisible()) ||
  "This dashboard is built in or the last of its type";

@ayme
export class SettingsPanel {
  readonly removeButton = this.root.getByTestId("removeButton");
  constructor(readonly root: Locator) {}

  @ayme.action({
    description: "Remove this dashboard. Needs a removable dashboard.",
    available: canRemove,
  })
  async remove() {
    await this.removeButton.click();
  }
}
```

- While the predicate fails, `ayme.tools.list()` flags the tool `available: false`, with the string as its `reason` when it returned one, an agent reads the reason where it learns about tool changes, and a call is refused with it before anything runs.
- The predicate runs with the runtime's observation of the page, not with the call, so it reads the page and never changes it.
- The [reference](../reference/ayme.md#action-availability) has the signature, how a collection and a predicate that throws are judged, and what an action without a predicate inherits.

Page Objects are registered by your framework package or by `ayme.pom`; [Publish tools](publish-tools.md) shows how Ayme starts.
