# Page Object Models

How to mark a Page Object Model and its actions so Ayme turns them into Page Object Tools, how those tools are named, and how Page Object Children become tools too.

## Mark a model and its actions

Keep your Page Object Model as it is. Mark the class with `@ayme` and each action to expose with `@ayme.action`; each marked action becomes a Page Object Tool:

```ts
import { ayme } from "@ayme-dev/ayme";
import type { Page } from "@playwright/test";

@ayme
export class GreetingPage {
  constructor(private readonly page: Page) {}

  @ayme.action({ description: "Greet the visitor." })
  async greet(name: string) {
    await this.page.getByRole("textbox", { name: "Name" }).fill(name);
    await this.page.getByRole("button", { name: "Greet", exact: true }).click();
  }
}
```

- Both decorators take an optional description: `@ayme({ description })` describes the model, and a bare `@ayme.action` publishes with a generated description. `description` is the only option.
- Only marked actions become tools. Public members are not published on their own.
- A class that extends an `@ayme` class is a Page Object Model too, even without the decorator. Its actions still need `@ayme.action`.
- No Ayme base class is needed, and the same class keeps working in your Playwright tests.

## Where models live

Put marked models in `.ts` files the application imports, with `experimentalDecorators` on; the [build plugin](../reference/build-plugin.md#what-it-compiles) compiles them. They run in the browser, so they use Playwright's types only, as [Playwright in the browser](../reference/playwright-in-the-browser.md) explains.

## Tool names and inputs

A Page Object Tool is named after its class and method: `GreetingPage.greet`. Registering a Page Object while a different class with the same name is registered throws; rename one of them.

The tool's input schema comes from the method's signature: an object with one property per parameter, required unless the parameter is optional. Parameters can be strings, numbers, booleans, unions of literals of one type (an enum), and object types made of such properties. Arrays, tuples, index signatures and functions are not supported, and the build fails naming the parameter.

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

A `root` locator member is the model's Page Object Root: the element that anchors the instance in the page. It decides whether the Page Object is present and available, and the page state labels that element with the Page Object's name. A child's tools are live only while its root is on the page and available, so a child needs a `root`. A registered top-level model without one has tools that are live as long as it is registered.

Page Objects are registered by your framework package or by `ayme.pom`; [Publish tools](publish-tools.md) shows how Ayme starts.
