# Page Object Models

How to mark a Page Object Model, decorator by decorator, so Ayme turns what a user does with it into Page Object Tools.

Put marked models in `.ts` files the application imports, with `experimentalDecorators` on; the [build plugin](../reference/build-plugin.md#what-it-compiles) compiles them. They run in the browser, so they use Playwright's types only, as [Playwright in the browser](../reference/playwright-in-the-browser.md) explains. A marked model stays your Page Object Model: it needs no Ayme base class, and it keeps working in your Playwright tests.

An agent sees each model as its definition: the model with its description, its children, then its actions with theirs. The examples below add up to this one:

```text
ProjectsPage // Projects of the current workspace, visible to every member.
  newProjectButton
  newProjectDialog: NewProjectDialog
  filterChips[] // Filters applied to the list.
  projects: ProjectRow[]

  openNewProjectDialog(): NewProjectDialog
```

A bare member is a Locator, `[]` marks a collection, `: Model` a child Page Object, and `//` a description.

## `@ayme`

`@ayme` marks a class as a Page Object Model. A model's tools are listed only while it is on the page, and its options say when.

**`present`** says when a page is on the page: a function that gets the live Page Object as `self` and answers `true` or `false`.
Write it once, on a page base class that checks the URL, so every page is present on its route and its tools follow the user's navigation:

```ts
const onPage = (self: AppPage) =>
  new URLPattern({ pathname: self.path }).test(self.page.url());

@ayme({ present: onPage })
export abstract class AppPage {
  abstract readonly path: string;
  constructor(readonly page: Page) {}
}

export class ProjectsPage extends AppPage {
  readonly path = "/projects";
}
```

Declare the function with a type, since TypeScript types an inline one's `self` as `unknown`. Ayme runs it whenever it observes the page, never as part of a call, so keep it to reads, such as the URL, visibility or text.

**`root`** returns the Locator of the element a component lives in, its Page Object Root. Write it once, on a component base class that takes that element:

```ts
const rootOf = (self: AppComponent) => self.root;

@ayme({ root: rootOf })
export abstract class AppComponent {
  constructor(readonly root: Locator) {}
}

export class NewProjectDialog extends AppComponent {
  readonly createButton = this.root.getByRole("button", { name: "Create" });
}
```

The root decides two things:

- **Present:** while its root matches exactly one element on the page, the component's tools are listed.
- **Available:** while a click would reach the root, its tools can run on it. When something covers the root, such as an open dialog, the tools stay listed. A call on that component is refused with a reason that names what is in the way. A tool shared by several components, such as a row's, shows `available: false` only when none of them can run it.

Availability is measured at the root, so a component's root should contain everything its actions touch.

A model without `present` or `root` follows something else:

- A registered model is on the page while it is registered.
- A child is on the page while the model holding it is.

**`description`** says what the model stands for in the product, beyond what the page shows: whose data it holds, how far it reaches, such as one project or the whole workspace, and what it holds that outlives the page. A model whose name and page say enough needs none.

```ts
@ayme({
  description: "Projects of the current workspace, visible to every member.",
})
export class ProjectsPage extends AppPage {
  readonly path = "/projects";
}
```

## `@ayme.action`

`@ayme.action` marks a method as a Page Object Action, which becomes a tool named after its class and method, such as `ProjectsPage.openNewProjectDialog`.
Leave helper methods that only read the page unmarked, such as ones that return a heading's text or count rows; your tests can still call them.

An action can return a Page Object, as `openNewProjectDialog` returns a `NewProjectDialog`. An agent is told what it returns: that tool's description reads `Shows NewProjectDialog.` Returning a Page Object does not make its actions tools. Only a Page Object a model declares, as [`@ayme.child`](#aymechild) shows, has its actions listed.

The method's parameters are the tool's inputs. Plain data works: strings, numbers, booleans, unions of literals, arrays, tuples and plain objects. A function, a class instance such as `Date`, an object with methods, `any`, `unknown` or an open generic fails the build, which names the parameter.

**`description`** tells an agent what it needs to use the action well that its name and parameters cannot: what it causes, who may do it, and how to use it. An action whose description would only restate its name needs none.

```ts
export class ProjectRow extends AppComponent {
  @ayme.child
  readonly archiveButton = this.root.getByRole("button", { name: "Archive" });

  @ayme.action({
    description:
      "Only the project's owner can archive it. Archived projects are restored from the Archived tab.",
  })
  async archive() {
    await this.archiveButton.click();
    return this;
  }
}
```

**`available`** declares when an action can run, for an action whose control shows only in some states or to some users.

Say a row shows its Remove button only to an admin of that project. The user is an admin of Launch plan but not of Q4 survey. `snapshot` marks each row's root with its class, `ProjectRow`:

```text
- e5 list:
  - e6 ProjectRow:
    - text: Launch plan
    - e7 button "Archive"
    - e8 button "Rename"
    - e9 button "Remove"
  - e10 ProjectRow:
    - text: Q4 survey
    - e11 button "Archive"
    - e12 button "Rename"
```

An agent names a row by the ref on its marked line. It calls `ProjectRow.remove({ ref: "e10" })` to remove Q4 survey. The call is refused before anything runs:

```text
RuntimeStateError: ProjectRow on ref "e10" is unavailable: Only admins can remove projects.
```

The reason comes from `available`. It is a function that gets the live Page Object and answers `true`, `false`, or a string that says why not:

```ts
const canRemove = async (self: ProjectRow) =>
  (await self.removeButton.isVisible()) || "Only admins can remove projects";

export class ProjectRow extends AppComponent {
  @ayme.child
  readonly removeButton = this.root.getByRole("button", { name: "Remove" });

  @ayme.action({ available: canRemove })
  async remove() {
    await this.removeButton.click();
    return this;
  }
}
```

`ProjectRow.remove` stays listed, because it can run on Launch plan. For a member who is not an admin of any project, no row shows Remove. The tool then stays listed with `available: false` and `reason: "Only admins can remove projects"`. An agent reads that reason with the other tool changes it is told about.

Like `present`, keep the predicate to reads.

## `@ayme.child`

`@ayme.child` declares one part of a model: a Locator that matches one element, or one Page Object. Only declared parts appear in the model's definition.

Declare what an agent reads or acts on, such as the inputs, buttons and lists the model's actions are about. Leave undeclared what only your tests or helper code use, layout wrappers, and the root itself.

A child Page Object needs the declaration too. Ayme reaches a component only through the members its models declare. Without `@ayme.collection` on `projects` below, no `ProjectRow` is reached, and `ProjectRow.remove` never becomes a tool. Nothing warns you. The [Inspector](inspector.md)'s Model view shows what a model holds.

```ts
export class ProjectsPage extends AppPage {
  readonly path = "/projects";

  @ayme.child
  readonly newProjectButton = this.page.getByRole("button", {
    name: "New project",
  });

  readonly rows = this.page.getByRole("listitem"); // not declared: projects() reads it

  @ayme.child
  readonly newProjectDialog = new NewProjectDialog(
    this.page.getByRole("dialog")
  );

  @ayme.action
  async openNewProjectDialog(): Promise<NewProjectDialog> {
    await this.newProjectButton.click();
    await this.newProjectDialog.root.waitFor();
    return this.newProjectDialog;
  }
}
```

A Locator declared `@ayme.child` that matches several elements logs a [warning](../reference/errors.md#messages), such as `ProjectsPage: its newProjectButton matches 2 elements.` An action on it then fails in Playwright's strict mode. Narrow the locator, or declare it `@ayme.collection`.

**`description`** says what the part is for, only when its name and the page do not.

## `@ayme.collection`

`@ayme.collection` declares many parts of one kind. It takes a Locator that matches any number of elements, or a method without parameters that returns Page Objects.

Return Page Objects from a method, not an array field. The method returns the rows the page shows now. An array field would keep the rows from when the model was built.

What to declare is as for [`@ayme.child`](#aymechild).

```ts
@ayme.collection({ description: "Filters applied to the list." })
readonly filterChips = this.page.getByTestId("filter-chip");

@ayme.collection
async projects(): Promise<ProjectRow[]> {
  return (await this.rows.all()).map((row) => new ProjectRow(row));
}
```

**`description`** works as for `@ayme.child`.

## Inheritance

A class that extends an `@ayme` class is a Page Object Model too, without a decorator of its own; its actions still need `@ayme.action`. It inherits `present`, `root` and `description`, each from the nearest base class that declares it, and every child its base classes declare.

A subclass that declares its own `present`, `root` or `description` overrides the inherited one and keeps the others. This drawer keeps `AppComponent`'s `root` and adds a `present`:

```ts
const isOpen = async (self: FiltersDrawer) =>
  (await self.root.getAttribute("data-state")) === "open";

@ayme({ present: isOpen })
export class FiltersDrawer extends AppComponent {}
```

`FiltersDrawer` is present only while both hold: its root matches one element on the page, and `isOpen` returns `true`.
