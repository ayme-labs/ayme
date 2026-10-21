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

## Write base classes for pages and components

Pages and components declare when they are on the page through two inherited
options of `@ayme`, `present` and `root`. Write each once, on a base class the
project owns, so most POMs carry no Ayme code beyond `@ayme.action`:

- A page base class whose `present` checks the URL against the page's `path`.
  Every page extends it and sets `path`; an app with a typed router calls the
  router's matcher in the predicate instead.
- A component base class whose `root` names the container the constructor
  takes. Every component extends it.

Fit them to the repo: reuse an existing base class for pages or components
when one exists and add the option there, and keep the project's names for the
container and the page. The predicate's argument is `self`, the live POM, and
is declared as a typed function (`const onPage = (self: AppPage) => ...`),
since an inline predicate gets `self: unknown`. It runs with Ayme's observation
of the page, never with a call, so it only reads.
[Pages and components](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/page-object-models.md#pages-and-components)
has both classes and the rules. A POM with neither option is present while it
is registered; a subclass overrides one option and keeps the other.

## Root a POM at what its actions touch

A POM's root must contain every element its actions touch. Ayme lists a
POM's tools while its
[Page Object Root](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/page-object-models.md#the-page-object-root)
is present on the page, and they are available while a click would reach the
root. A root a click would not reach, covered or blocked by a modal, keeps its
tools listed but unavailable, with a reason naming what is in the way, and a
call is refused with that reason. Actions on elements outside the root are
therefore refused exactly when they are needed, for example while a modal menu
or dialog that blocks pointer events on the rest of the page is open.

Portaled content, such as menus, dialogs, and popovers, gets its own POM rooted
at that content, through the component base class or its own `root`. The trigger that opens it stays on the parent POM. Expose the
content POM as a member of the parent, a
[Page Object Child](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/page-object-models.md#page-object-children),
so its tools are published, and return it from the opening action.

```ts
// Rooted at the portaled content, a page-level locator rather than a descendant of the trigger.
@ayme({ root: (self: ProfileMenuContent) => self.root })
class ProfileMenuContent {
  readonly root: Locator;

  constructor(page: Page) {
    this.root = page.getByTestId("profile-menu");
  }
}

// On the parent POM, which keeps the trigger:
readonly content = new ProfileMenuContent(this.page);

@ayme.action
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

## Choose locators

Prefer, in order: a test id; a role or label locator; CSS or XPath when
neither fits. Scope a member's locator to the POM's root. Visible text changes
with copy and locale, so match with `getByText` only when nothing else tells
members apart.

## Name actions by user intent

Use names that explain the action and scope. `openCreateMenu()` communicates the
transition; `clickPlus()` describes an implementation detail.
`openProjectCreation()` opens a form; `create()` completes creation.

## Describe what the action means for the product

An agent sees a tool's name, its input schema, its availability and, after a
call, what changed on the page, for one user, in this view. A description says
what the action means beyond that, as product docs would: who may do it, and
what it commits that outlives the page or reaches other people. An action that
only changes the UI, such as opening a menu or filling a field, needs none: a
bare `@ayme.action` on `openCreateMenu()` says as much as "Open the create
menu." would.

## Make actions do something

Mark a method with `@ayme.action` only when it does something a user does:
clicking, filling, opening, submitting. Read-only methods, such as getting a
heading's text, counting rows, or checking whether an error shows, are not
actions. The snapshot already shows the agent what the page displays, so a read
as a tool only repeats it. Keep such reads as plain methods or locators for
tests and other code.

```ts
@ayme.action({
  description:
    "Archived projects disappear for every member until restored from Archived.",
})
async archive() {
  await this.archiveButton.click();
  return this;
}

// Not an action: the snapshot already shows the heading.
async title() {
  return this.heading.textContent();
}
```

## Finish in the target state

An action ensures a state and returns once that state holds, observed on its
own root and children. `openSettings()` clicks only when the panel isn't
already open; a dialog's `save()` returns once the dialog has closed, not when
Save was clicked.

## Declare when an action can run

An action that is possible only in some states, such as removing a dashboard
that is not built in, keeps its natural POM and declares the condition with
`available`, an availability predicate, instead of a root at the one control
that comes and goes or a method that throws. The tool stays listed; while the
predicate fails, it is flagged unavailable, with the string as its reason when
it returned one, and a call is refused with that reason before anything runs.
[Action availability](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/page-object-models.md#action-availability)
has the signature, the example and the rules.

The reason states the fact ("No item is selected"), so the description need not
repeat the condition. The predicate runs
with Ayme's observation of the page, not with the call, so it only reads:
visibility, enabled state, text, counts. It never clicks, scrolls, focuses or
changes the page. One predicate can guard several actions.

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
  private readonly page: Page;
  readonly owner?: Owner;

  constructor(page: Page, owner?: Owner) {
    this.page = page;
    this.owner = owner;
  }

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
