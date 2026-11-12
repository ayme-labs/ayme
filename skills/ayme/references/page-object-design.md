# Page object design

The examples follow one flow: on a projects page, the user opens a dialog,
picks an owner in a combobox and creates a project.

## Find the boundaries

A page object stands for a boundary: a part of the UI the user's next
interaction happens in. A page is the outermost boundary. Inside it, look for:

- An element that appears and disappears as the user works, such as a menu, a
  dialog, a drawer or a picker.
- A repeated structure, such as rows or cards. Each repeated item is a boundary
  of its own, and the controls inside an item belong to the item, never to the
  page or the list.

A boundary becomes a page component when it owns an action or holds parts to
read, such as a project row with its name and owner. Revealing a button or expanding
explanatory text stays within the current boundary.

## Write base classes for pages and components

A page takes Playwright's `Page`. A component takes the `Locator` of its
root, and its members are scoped to that root. Write each base
once, so every page and component extends one.

```ts
export abstract class AppPage {
  constructor(readonly page: Page) {}
}

export abstract class AppComponent {
  constructor(readonly root: Locator) {}
}
```

## Root a component at what its actions touch

A component's root contains every element its actions touch, and its members'
locators are scoped to that root.

Follow what the user sees as one part, not necessarily where it renders. A
combobox's dropdown belongs to the combobox, even when the app renders the
dropdown elsewhere in the page. Give that part its own component, rooted where
it renders, and make it a child of the component it belongs to:

```ts
export class Combobox extends AppComponent {
  readonly input = this.root.getByRole("combobox");
  // Rendered at the end of the document, so located from the page.
  readonly options = new ComboboxOptions(this.root.page().getByRole("listbox"));

  async select(option: string) {
    await this.input.click();
    await this.options.choose(option);
    return this;
  }
}

export class ComboboxOptions extends AppComponent {
  async choose(option: string) {
    await this.root.getByRole("option", { name: option, exact: true }).click();
    return this;
  }
}
```

## Return repeated components from a method

A repeated item becomes a component when it has actions or parts to read, as
any boundary does; a list of plain items stays one locator matching all of
them. Return repeated components one per element from a method without
parameters, so a caller gets the items the page shows when it asks:

```ts
// On ProjectsPage:
async projects(): Promise<ProjectRow[]> {
  return (await this.page.getByRole("row").all()).map(
    (row) => new ProjectRow(row)
  );
}

// ✅ A component: each row has parts to read and an action of its own.
export class ProjectRow extends AppComponent {
  readonly name = this.root.getByTestId("project-name");
  readonly owner = this.root.getByTestId("project-owner");
  readonly archiveButton = this.root.getByRole("button", { name: "Archive" });

  // ❌ Not components: each tag is plain text, with nothing to read inside it
  // and nothing to do.
  readonly tags = this.root.getByTestId("project-tag");

  async archive() {
    await this.archiveButton.click();
    return this;
  }
}
```

## Place each action on the boundary of its trigger

An action belongs to the closest boundary around the element that triggers it.
When that boundary is not a component yet, make it one rather than lifting the
action higher.

A dialog has no `open()` of its own, since the button that opens it lives
outside the dialog. The page owns that button, so the page owns the action,
and holds the dialog as its child:

```ts
// On ProjectsPage:
readonly newProjectDialog = new NewProjectDialog(this.page.getByRole("dialog"));

async openNewProjectDialog() {
  await this.newProjectButton.click();
  await this.newProjectDialog.root.waitFor();
  return this.newProjectDialog;
}
```

## What makes an action

A method is an action when it moves the user to another boundary, or groups
the interactions of one goal, such as filling a form's fields. A single click
or fill is not worth promoting to an action: the control stays a named
locator.

```ts
// On ProjectsPage:
// ✅ An action: it moves the user to another boundary.
async openNewProjectDialog() {
  await this.newProjectButton.click();
  await this.newProjectDialog.root.waitFor();
  return this.newProjectDialog;
}

// On NewProjectDialog:
// ✅ An action: one goal, several interactions.
async fillProjectForm(name: string, owner: string) {
  await this.nameInput.fill(name);
  await this.owner.select(owner);
  return this;
}

// ❌ Not an action: `nameInput` is already a locator a caller can fill.
async fillNameInput(name: string) {
  await this.nameInput.fill(name);
}
```

## Locator Strategy

Prefer, in order: a test id; a role or label locator; CSS or XPath when
neither fits. Visible text changes with copy and locale, so match with
`getByText` only when nothing else tells members apart. Replace a locator that
is likely to break or match the wrong element:

- Text that spans several elements, such as a container's whole text run
  together.
- A position, `nth()` or `first()`, among generic elements.
- A locator that matches an ancestor of the element rather than the element.

## Compute derived state in a query method

Tests check state through the locators directly, with Playwright's web-first
assertions. Add a method only when a test needs one value that several
locators decide together, or a value parsed or normalized from one, and name
it after that value. A method that wraps one locator call, such as
`isBadgeVisible()`, adds nothing.

```ts
export class ProjectEditor extends AppComponent {
  readonly errorBanner = this.root.getByRole("alert");
  readonly spinner = this.root.getByRole("progressbar");
  readonly savedBadge = this.root.getByText("Saved");
  readonly taskCount = this.root.getByTestId("task-count"); // "12 tasks"

  // Several locators decide one value.
  async saveState() {
    const [error, saving, saved] = await Promise.all([
      this.errorBanner.isVisible(),
      this.spinner.isVisible(),
      this.savedBadge.isVisible(),
    ]);
    if (error) return "error";
    if (saving) return "saving";
    if (saved) return "saved";
    return "idle";
  }

  // A value parsed from one locator.
  async tasks() {
    return Number.parseInt(await this.taskCount.innerText(), 10);
  }
}
```

A test checks them with `expect.poll`, which retries as web-first assertions
do: `await expect.poll(() => editor.saveState()).toBe("saved")`.

## Name actions between interaction and intent

Name an action above the raw interaction and below the business goal: a UI
verb, with a business noun when it helps. `openNewProjectDialog()` and
`fillProjectForm()` say what happens; `clickPlus()` restates the interaction,
and `launchProject()` hides which UI it drives.

## Use generic components for generic UI

A control with no business meaning, such as a combobox, a menu or a modal, is
a generic component: named after the control, free of the app's terms, and
reused across pages. It knows nothing about the app's flow, so its actions
return only what is its own, such as itself. The page or component that uses
it knows where the flow continues:

```ts
export class Modal extends AppComponent {
  readonly closeButton = this.root.getByRole("button", { name: "Close" });

  async close() {
    await this.closeButton.click();
    await this.root.waitFor({ state: "hidden" });
    return this;
  }
}

// The dialog is a Modal with app meaning: it knows the projects page is
// behind it.
export class NewProjectDialog extends AppComponent {
  readonly modal = new Modal(this.root);

  async cancel() {
    await this.modal.close();
    return new ProjectsPage(this.root.page());
  }
}
```

## Know only yourself and your children

A page object uses its own members and its children: the components it holds
as members. The page or component an action leads to is named only as the
action's return value; its locators and its actions belong to whoever
continues there.

```ts
// On NewProjectDialog:
// ❌ Reaches into the page that follows.
async create() {
  await this.createButton.click();
  const projectPage = new ProjectPage(this.root.page());
  await projectPage.heading.waitFor();
  await projectPage.dismissWelcomeTip();
  return projectPage;
}

// ✅ Uses only the dialog's own button, and names where the user continues.
async create() {
  await this.createButton.click();
  return new ProjectPage(this.root.page());
}
```

## Wait only for the action's own outcome

An action returns once its own outcome shows on its own root and children:
its dialog closed, its error message appeared, its button stopped spinning.
`openSettings()` clicks only when its panel isn't already open, and returns
once the panel is. An action that leaves the page returns after its last
interaction; waiting for the navigation and the next page belongs to whoever
drives the browser, such as a test's next assertion.

```ts
// On SignInPage:
// ❌ Waits for the page that follows.
async logIn(email: string, password: string) {
  await this.fillCredentials(email, password);
  await this.logInButton.click();
  await this.page.waitForURL("/projects");
  return new ProjectsPage(this.page);
}

// ✅ Waits for its own error message, the one outcome this page shows.
async logIn(email: string, password: string): Promise<ProjectsPage | this> {
  await this.fillCredentials(email, password);
  await this.logInButton.click();
  const refused = await this.errorMessage.waitFor({ timeout: 1_000 }).then(
    () => true,
    () => false
  );
  return refused ? this : new ProjectsPage(this.page);
}
```

## Return where the user continues

An action promises the boundary the user's next interaction happens in, and
promises only what always holds:

- When it always leads to the same place, return that page or component.
- When it has one of several outcomes, such as a created project or a
  validation error, wait for whichever of its own outcomes appears and return
  the matching page or component. The return type is their union, and a test
  asserts which one it got.
- Otherwise, such as when it closes back to whichever page opened it, return
  `this`, and let the caller continue.

When none of its own outcomes appears, let the action fail rather than
returning one of them anyway.

```ts
// On NewProjectDialog:
async create(): Promise<ProjectPage | this> {
  await this.createButton.click();
  // The dialog's own outcomes: it closed, or it shows its error. With
  // neither, both waits time out and the action fails.
  const closed = await Promise.any([
    this.root.waitFor({ state: "hidden" }).then(() => true),
    this.nameError.waitFor().then(() => false),
  ]);
  return closed ? new ProjectPage(this.root.page()) : this;
}
```

A test asserts the outcome the flow should reach, rather than branching on it.
Its web-first assertion is what waits for the next page:

```ts
const created = await dialog.create();
assert(created instanceof ProjectPage); // node:assert, which narrows the type
await expect(created.heading).toBeVisible();

// Or, when the test expects the dialog to remain open, with the validation error:
const rejected = await dialog.create();
assert(rejected === dialog);
await expect(rejected.nameError).toBeVisible();
```

## State facts in descriptions and reasons

When a page object is marked for Ayme, an agent reads its descriptions and,
for an action that cannot run now, the reason. Each states a fact about the
page object: what the action causes, who may do it, why it cannot run. The
agent decides its next step itself.

```ts
// ❌ Each tells the agent what to do.
const canSave = async (self: ProjectEditor) =>
  (await self.saveButton.isVisible()) ||
  "This project is archived. Call restore first, then save.";

@ayme.action({
  available: canSave,
  description: "Saves the project. Leave out the fields that stay as they are.",
})

// ✅ Each states a fact.
const canSave = async (self: ProjectEditor) =>
  (await self.saveButton.isVisible()) ||
  "This project is archived, and an archived project has no Save.";

@ayme.action({
  available: canSave,
  description: "Saves the project and keeps the editor open.",
})
```

## Compose actions

An action can call the actions of its children. A call that moves the user
out of the action's boundary comes last, and the action returns what that call
returns:

```ts
// On ProjectsPage:
async createProject(name: string, owner: string) {
  const dialog = await this.openNewProjectDialog();
  await dialog.fillProjectForm(name, owner);
  return dialog.create();
}
```
