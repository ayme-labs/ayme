# Page object design

## Model interaction scopes

Give a distinct actionable surface a POM when it becomes the context for the
user's next interaction. Pages, menus, dialogs, drawers, and meaningful pickers
are candidates. Judge the interaction context rather than DOM keyboard focus or
component boundaries.

Example: opening Create returns a menu POM; choosing Project opens a
creation-dialog POM. Revealing a button or expanding explanatory text stays
within the current POM. An advanced-settings section needs a separate POM only
when its independent behavior makes that useful.

## Root a POM at what its actions touch

A POM's `root` must contain every element its actions touch. Ayme publishes a
POM's tools only while its
[Page Object Root](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/page-object-models.md#the-page-object-root)
is present and available, not covered or blocked by a modal. Actions on elements
outside the root can therefore be withdrawn exactly when they are needed, for
example while a modal menu or dialog that blocks pointer events on the rest of
the page is open.

Portaled content, such as menus, dialogs, and popovers, gets its own POM rooted
at that content. The trigger that opens it stays on the parent POM. Expose the
content POM as a member of the parent, a
[Page Object Child](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/page-object-models.md#page-object-children),
so its tools are published, and return it from the opening action.

```ts
// Rooted at the portaled content, a page-level locator rather than a descendant of the trigger.
@ayme
class ProfileMenuContent {
  readonly root: Locator;

  constructor(page: Page) {
    this.root = page.getByTestId("profile-menu");
  }
}

// On the parent POM, which keeps the trigger:
readonly content = new ProfileMenuContent(this.page);

@ayme.action({ description: "Open the signed-in user profile menu." })
async open() {
  await this.menu.open();
  return this.content;
}
```

## Keep controls as locators

Expose individual buttons, links, and inputs as named locators. Introduce helper
objects when they supply meaningful reusable behavior. Include collections when
the flow or structural observation needs them.

```ts
readonly createButton = this.root.getByTestId("create-button");
```

A picker with date-selection behavior can justify a helper; a single button does
not need a Page Object wrapper merely to click it.

Prefer test ids over visible text; text changes with copy and locale.

## Name actions by user intent

Use names that explain the action and scope. `openCreateMenu()` communicates the
transition; `clickPlus()` describes an implementation detail.
`openProjectCreation()` opens a form; `create()` completes creation.

## Make actions do something

Mark a method with `@ayme.action` only when it does something a user does:
clicking, filling, opening, submitting. Read-only methods, such as getting a
heading's text, counting rows, or checking whether an error shows, are not
actions. The snapshot already shows the agent what the page displays, so a read
as a tool only repeats it. Keep such reads as plain methods or locators for
tests and other code.

```ts
@ayme.action({ description: "Archive the selected project." })
async archive() {
  await this.archiveButton.click();
  return this;
}

// Not an action: the snapshot already shows the heading.
async title() {
  return this.heading.textContent();
}
```

## Separate helper returns from flow returns

Generic UI helpers such as Menu and Modal return `this` for chaining and
inspection, including after closing. Application POMs contain domain knowledge
and return where interaction continues.

| Application action outcome                      | Return                                     |
| ----------------------------------------------- | ------------------------------------------ |
| Interaction stays in the surface                | `this`                                     |
| Another actionable surface opens                | Destination POM                            |
| Close/cancel returns to the opener              | Owner POM                                  |
| Submission succeeds and navigates               | Resulting page POM                         |
| Expected validation failure keeps the form open | `this`                                     |
| External or terminal action                     | Explicit outcome or `void`, as appropriate |

Example: `Menu.close()` returns the hidden menu for inspection.
`CreateMenu.close()` closes its composed Menu and returns the application
surface where interaction resumes.

Determine conditional returns from observed outcomes after the relevant
transition. Propagate unexpected execution failures rather than treating all
errors as validation failures.

## Pass the owner explicitly

Application POMs can accept their logical owner in the constructor. Owner is the
continuing interaction surface, not DOM parent or selector host.

Illustrative API sketch, with `modal` representing the composed generic Modal
helper:

```ts
class CreateProjectDialog<Owner> {
  constructor(
    private readonly page: Page,
    readonly owner?: Owner
  ) {}

  async close() {
    await this.modal.close();
    return this.owner;
  }

  // create(): observed success -> ProjectPage
  //           observed validation failure -> this
}

const creation = new CreateProjectDialog(this.page, this);
```

An optional owner makes the close result optional. Preserve that honestly;
require an owner when the flow requires one. A generic owner type can retain a
concrete caller type when needed. Use constructor-based ownership until actual
differing flows require more machinery.

If the opening menu disappears, identify where cancellation really resumes
before assigning that menu as owner. Successful creation follows its actual
destination even when cancellation returns to the opener.

## Compose reusable behavior

An application menu owns a generic Menu helper and defines its domain choices
and return types. Inherit the project's base class for the surface, if it has
one, and compose interaction helpers.

```ts
async close() {
  await this.menu.close();
  return this.owner;
}
```

Reuse destination POMs after checking their scope and runtime dependencies. An
existing test POM is not automatically browser-compatible; see
[Playwright in the browser](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/playwright-in-the-browser.md).

## Illustrate a coherent journey

Show a short usage example when it helps the user assess a new API. This is a
design aid, not a required test or an approval gate for every change.

```ts
const menu = await topBar.openCreateMenu();
const creation = await menu.openProjectCreation();
await creation.fillProjectName("Launch plan");
const result = await creation.create();
// Result is the observed destination or the form with validation errors.
```

Show alternate outcomes separately instead of continuing to choose items from an
already-closed menu. During prototyping, label proposed versus implemented and
observed behavior.
