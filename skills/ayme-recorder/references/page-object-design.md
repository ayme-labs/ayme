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

The flow's page objects, which the sections below add actions to:

```ts
export class ProjectsPage extends AppPage {
  readonly newProjectButton = this.page.getByRole("button", {
    name: "New project",
  });
}

export class NewProjectDialog extends AppComponent {
  readonly nameInput = this.root.getByLabel("Name");
  readonly nameError = this.root.getByTestId("name-error");
  // The owner picker, the Combobox from above.
  readonly owner = new Combobox(this.root.getByTestId("owner"));
  readonly createButton = this.root.getByRole("button", { name: "Create" });
}

// The page a created project opens on.
export class ProjectPage extends AppPage {
  readonly heading = this.page.getByRole("heading", { level: 1 });
}
```

## Return repeated components from a method

A repeated item becomes a component when it has actions or parts to read, as
any other boundary does. A list of plain items stays one locator that matches
all of them. Return the components from a method without parameters, one per
element. Each call then returns the items the page shows at that moment:

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
outside the dialog. The page owns that button, so the page owns the action:

```ts
// On ProjectsPage:
async openNewProjectDialog() {
  await this.newProjectButton.click();
  const dialog = new NewProjectDialog(this.page.getByRole("dialog"));
  await dialog.root.waitFor();
  return dialog;
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
  const dialog = new NewProjectDialog(this.page.getByRole("dialog"));
  await dialog.root.waitFor();
  return dialog;
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

```ts
// On ProjectRow, locating the project's name:
// ❌ The row's whole text, run together across its cells.
this.root.page().getByText("Website redesign Abel Archive");
// ❌ A position among generic elements.
this.root.locator("div").nth(2);
// ❌ The row around the name, not the name.
this.root.page().locator("tr", { hasText: "Website redesign" });
// ✅
this.root.getByTestId("project-name");
```

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

// On NewProjectDialog: it holds a generic Modal and adds the app's meaning.
// It knows the projects page is behind it.
readonly modal = new Modal(this.root);

async cancel() {
  await this.modal.close();
  return new ProjectsPage(this.root.page());
}
```

## Finish in the target state

An action returns once the state it promises holds, not once its last click
is done. `openNewProjectDialog()` waits for the dialog's root before it
returns the dialog. `create()`, below, waits until the project's page or the
name error shows.

## Return where the user continues

An action promises the boundary the user's next interaction happens in, and
promises only what always holds:

- When it always leads to the same place, return that page or component.
- When the page shows one of several outcomes, such as a created project or a
  validation error, wait for whichever appears and return the matching one.
  The return type is their union, and a test asserts which one it got.
- Otherwise, such as when it closes back to whichever page opened it, return
  `this`, and let the caller continue.

When none of the outcomes appears, let the action fail rather than returning
one of them anyway.

```ts
// On NewProjectDialog:
async create(): Promise<ProjectPage | this> {
  await this.createButton.click();
  const projectPage = new ProjectPage(this.root.page());
  await projectPage.heading.or(this.nameError).first().waitFor();
  return (await this.nameError.isVisible()) ? this : projectPage;
}
```

A test asserts the outcome the flow should reach, rather than branching on it:

```ts
const created = await dialog.create();
assert(created instanceof ProjectPage); // node:assert, which narrows the type
await expect(created.heading).toBeVisible();

// Or, when the test expects the dialog to remain open, with the validation error:
const rejected = await dialog.create();
assert(rejected === dialog);
await expect(rejected.nameError).toBeVisible();
```

## Compose actions

An action can call the actions of its children and of the components it opens.
A call that moves the user out of the action's boundary comes last, and the
action returns what that call returns:

```ts
// On ProjectsPage:
async createProject(name: string, owner: string) {
  const dialog = await this.openNewProjectDialog();
  await dialog.fillProjectForm(name, owner);
  return dialog.create();
}
```
