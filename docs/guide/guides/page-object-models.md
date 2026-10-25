# Page Object Models

How to mark a Page Object Model and its actions so Ayme turns them into Page Object Tools, how those tools are named, when a page or a component is on the page, and how Page Object Children become tools too.

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

  @ayme.action
  async createProject(name: string) {
    await this.page.getByRole("button", { name: "New project" }).click();
    await this.page.getByRole("textbox", { name: "Project name" }).fill(name);
    await this.page.getByRole("button", { name: "Create" }).click();
  }
}
```

- Both decorators take an optional description, a constant string: a string literal, a template literal without `${...}`, or a `+` concatenation of those. The build reads it from the source and fails on any other expression. `@ayme({ description })` describes the model, and a bare `@ayme.action` publishes without one over Ayme MCP. WebMCP requires a description, so there it gets `Run createProject.` for the action above. An action that returns another Page Object gets `Then shows <Model>.` after its description, or as its description when it has none. When the returned model is a member of another model, the sentence names the path its tools are published under, as in `Then shows SurveyResponsesPage.filter (ResponseFilterPopover).` A description says what the action means for the product beyond what an agent sees on the page: who may do it, and what it commits that outlives the page or reaches other people. An action that only changes the UI needs none. A model's description says the same for the surface: whose data it shows, how far it reaches (one project or the whole workspace), and what it holds that outlives the page. A model whose name and page say enough needs none. Agents read it in the model's definition, which the `snapshot` tool returns. A subclass inherits it, from the nearest base class that declares one, and may declare its own. `@ayme` also takes `present` and `root`, which say when the model is on the page; see [Pages and components](#pages-and-components). `@ayme.action` also takes `available`, the action's availability predicate; see [Action availability](#action-availability).
- Only marked actions become tools. Public members are not published on their own.
- A class that extends an `@ayme` class is a Page Object Model too, even without the decorator. Its actions still need `@ayme.action`.
- No Ayme base class is needed, and the same class keeps working in your Playwright tests.

## Where models live

Put marked models in `.ts` files the application imports, with `experimentalDecorators` on; the [build plugin](../reference/build-plugin.md#what-it-compiles) compiles them. They run in the browser, so they use Playwright's types only, as [Playwright in the browser](../reference/playwright-in-the-browser.md) explains.

## Tool names and inputs

A Page Object Tool is named after its class and method: `ProjectsPage.createProject`. Ayme tells classes apart by name, so a Page Object is not registered when it, or a Page Object Child it reaches at any depth, shares its name with a class declared in another file that it or a registered Page Object reaches. The refusal is logged to the console, not thrown, and its tools are not listed; rename one of the classes.

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

`undefined` in a union makes the parameter optional; `null` does not. A rest parameter, `...refs: string[]`, is a list, optional unless its tuple type has required elements. A recursive type is described down to its first repeat, which takes any array or object.

Functions, class instances such as `Date`, object types with methods or getters, `unknown`, `any` and open generics have no schema. An action taking one fails the build naming the parameter, and the build lists an unmarked method taking one; see the [build plugin's report](../reference/build-plugin.md#report).

## Pages and components

A Page Object's tools are listed while it is present: a page while the browser is on it, a component while its element is on the page. A model says when with two options of the decorator, `present` and `root`. Each is a predicate that gets the live Page Object as `self` and runs with the runtime's observation of the page, never with a call; declare it as a typed function, since TypeScript gives an inline predicate `self: unknown`. Write each once, on a base class of your own, and every model extending it inherits it. A model whose class chain declares neither is present while it is registered, like `ProjectsPage` above.

### Page presence

A page declares when it is on the page with `present`: a presence predicate that answers `true` or `false`. A page base class that checks the URL makes every page extending it present on its route:

```ts
const onPage = (self: AppPage) =>
  new URLPattern({ pathname: self.path }).test(self.page.url());

@ayme({ present: onPage })
export abstract class AppPage {
  abstract readonly path: string;
  constructor(readonly page: Page) {}
}

export class ProjectPage extends AppPage {
  readonly path = "/projects/:id";

  @ayme.action
  async archive() {
    await this.page.getByRole("button", { name: "Archive" }).click();
  }
}
```

- `ProjectPage` needs no decorator of its own; a subclass that declares its own `present` overrides the base's.
- The predicate runs with the runtime's observation of the page, also after `pushState`, `replaceState` and `popstate`, so the page's tools appear and disappear as the user moves through a single-page app. A call never runs it.
- A page the browser is not on is withdrawn; a present page under a dialog stays listed with its reason.
- A page that is present by its URL can be registered once, at app setup, with every other page; [Register Page Objects](publish-tools.md#register-page-objects) says when to register at a component instead.
- The [reference](../reference/ayme.md#page-object-presence) has the signature, how a predicate that throws is judged, what a rooted model with a predicate needs, and typed route parameters.

### The Page Object Root

A component names its Page Object Root, the element that anchors the instance in the page, with `root`: a root predicate that answers a Locator. A component base class that takes its container makes every component extending it anchored there:

```ts
const rootOf = (self: AppComponent) => self.container;

@ayme({ root: rootOf })
export abstract class AppComponent {
  constructor(readonly container: Locator) {}
}

export class ListItem extends AppComponent {
  readonly archiveButton = this.container.getByRole("button", {
    name: "Archive",
  });

  @ayme.action
  async archive() {
    await this.archiveButton.click();
  }
}
```

- The root decides whether the Page Object is present, while the root is on the page, and whether it is available, while a click would also reach the root; the page state labels that element with the Page Object's name, and a collection item's `ref` is that element's.
- `ListItem` needs no decorator of its own; a subclass that declares its own `root` overrides the base's. `root` and `present` are inherited separately: a drawer that extends `AppComponent` and adds `present` is present while its root is on the page and it is open.
- The member that holds the root locator, `container` here, is the root and not a child, so the page state does not list it twice. Only the option anchors a model: a model whose class chain declares none is root-less, also when it has a member named `root`.
- A root-less class must be reached from exactly one place across registered Page Objects. Reaching it through two members, through a collection, or through separately registered Page Objects makes it ambiguous. At registration, Ayme logs an error naming the class and the places that reach it, and withholds only that class's tools. A collection's item class and every Page Object Child below it need a decorator `root` option, including an inherited one; a member named `root` alone does not count. Re-registering after adding a root restores the tools. What a model without a root is present for is in the [reference](../reference/ayme.md#page-object-root).

Presence lists tools; availability says whether they would run. A present Page Object whose root a click would not reach, such as one under an open dialog, keeps its tools listed, flagged unavailable with a reason that names what is in the way, and a call is refused with that reason. [`ayme.tools`](../reference/ayme.md#aymetools) has the form of the reason.

## Page Object Children

A model can hold other Page Objects as Page Object Children: a field or getter typed as a model holds one, and an async method without parameters that returns an array of a model holds several, a collection. Their actions become tools too, named by the path from the registered model:

```ts
@ayme
export class ListPage {
  readonly archiveDialog: ArchiveDialog; // one Page Object Child

  async items(): Promise<ListItem[]> {
    // several Page Object Children: a collection
    const rows = await this.itemRows.all();
    return rows.map((row) => new ListItem(row));
  }
}

// Anchored at the row: AppComponent names the Page Object Root, above.
export class ListItem extends AppComponent {
  @ayme.action
  async archive() {
    // ...
  }
}
```

- A collection's actions are published once for all its items: `ListPage.items.archive` takes `{ ref, args }`, where `ref` is the Structural Ref of the item's Page Object Root in the page state and `args` holds the action's own input. `args` may be left out when the action needs no input.
- A single child's actions take their input directly: a marked `confirm` on `ArchiveDialog` would be `ListPage.archiveDialog.confirm`.

A collection's items can hold items of their own model:

```ts
export class ListItem extends AppComponent {
  async subItems(): Promise<ListItem[]> {
    // ...
  }

  @ayme.action
  async archive() {
    // ...
  }
}
```

The page state gives every item a ref, however deep:

```text
- e5 ListPage.items[0]: Groceries
  - e9 ListPage.items[0].subItems[0]: Milk
```

`ListPage.items.archive` takes either ref:

```ts
ListPage.items.archive({ ref: "e5" }); // archives Groceries
ListPage.items.archive({ ref: "e9" }); // archives Milk
```

## Action availability

An action that is possible only in some states, such as removing a dashboard that is not built in, declares when it can run with `available`: an availability predicate that gets the live Page Object and answers `true`, `false`, or a string that says why not. The action keeps its natural Page Object, and the tool stays listed either way:

```ts
const canRemove = async (self: SettingsPanel) =>
  (await self.removeButton.isVisible()) ||
  "This dashboard is built in or the last of its type";

export class SettingsPanel extends AppComponent {
  readonly removeButton = this.container.getByTestId("removeButton");

  @ayme.action({
    description:
      "Only workspace admins can remove dashboards. Removes it for everyone in the workspace.",
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

Page Objects are registered by your framework package or by `ayme.pom`; [Register Page Objects](publish-tools.md#register-page-objects) says where.
