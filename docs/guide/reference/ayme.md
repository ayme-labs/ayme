# @ayme-dev/ayme

The decorators, `createAyme` and the session it returns, and the other exports of `@ayme-dev/ayme` and its entries.

## Entries

| Entry                   | For                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `@ayme-dev/ayme`        | Your app: the decorators, `createAyme`, `createPage`, `decisionEndpoint`, the errors and their types. |
| `@ayme-dev/ayme/server` | Your backend: `createDecisionEndpoint`, the Decision Endpoint handler.                                |

Three more entries serve Ayme itself: `@ayme-dev/ayme/internal`, `@ayme-dev/ayme/inspector` and `@ayme-dev/ayme/absent`. Applications import none of them, and they may change in any release.

A build without Ayme resolves `@ayme-dev/ayme` and `@ayme-dev/ayme/internal` to `@ayme-dev/ayme/absent`; see [Include Ayme in a build](build-plugin.md#include-ayme-in-a-build). Such a build publishes nothing, so its `createAyme` logs an error when `webMCP.enabled` is on.

## Decorators

| Decorator                                                    | Marks                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@ayme` or `@ayme({ description, root, present })`           | A class as a Page Object Model. Its subclasses are Page Object Models too. A subclass inherits `description`, `root` and `present` and may declare its own. `root` is the model's root predicate and `present` its presence predicate; see below.                              |
| `@ayme.action` or `@ayme.action({ description, available })` | A method as a Page Object Action, published as a Page Object Tool. `available` is the action's availability predicate, and [Action descriptions](#action-descriptions) says what agents read. [Page Object Models](../guides/ayme-page-objects.md#aymeaction) covers the rest. |
| `@ayme.child` or `@ayme.child({ description })`              | A field or getter as a Page Object Child: a Locator expected to match one element, or one Page Object.                                                                                                                                                                         |
| `@ayme.collection` or `@ayme.collection({ description })`    | A field or getter holding a Locator, or a method without parameters returning Page Objects, as a Child Collection.                                                                                                                                                             |

[Page Object Models](../guides/ayme-page-objects.md) covers marking a model and its actions, tool names and inputs, Page Object Children and inheritance.

### Page Object Children

`@ayme.child` and `@ayme.collection` take the same options (`AymeChildOptions`): an optional `description`, a constant string that agents read after the member in its model's definition. Both type-check with TypeScript's legacy and standard decorators, as `@ayme.action` does. The build plugin reads them from the source: only a declared member is a Page Object Child, and a declaration whose member does not fit fails the build. At runtime they keep nothing, and a [build without Ayme](build-plugin.md#include-ayme-in-a-build) leaves them out with the rest of the model, as it does `@ayme.action`. [Page Object Children](../guides/ayme-page-objects.md#aymechild) has the members each fits and what an undeclared member is.

### Page Object root and presence

`root` and `present` are predicates that get the live Page Object instance as `self`. Declared as their own functions, they type `self`.

A subclass inherits each from the nearest class in its chain that declares it, with or without a decorator of its own. It may declare its own. `root` and `present` are inherited separately, so a subclass can override one and keep the other.

They can run at any time, but never as part of a tool call. So they must only read: they must not scroll, click, focus or change the page. They never run on the server.

### Page Object presence

`present` is a presence predicate, `(self) => boolean | Promise<boolean>` (`PresencePredicate`). When it returns `true`, the Page Object is on the page and its tools are listed. When it returns `false`, its tools are withdrawn. To keep a tool listed but refused with a reason, use [`available`](#action-availability) instead.

A page base class that checks the URL makes every page that extends it present on its route:

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

Without `present`, a model is present while its [root](#page-object-root) is on the page. With both, the root must be on the page and the predicate must return `true`. A root-less child with `present` is judged by its predicate alone.

A predicate that reads the URL follows client-side routing and the browser's Back and Forward.

A predicate that throws makes the Page Object absent. The console gets the error with the class, such as `ProjectsPage: its present predicate threw TypeError: store is undefined.`, once until the error changes.

Presence adds and withdraws tools. A present Page Object's availability is still measured at its root. [Register Page Objects](../guides/publish-tools.md#register-page-objects) says where a page such as `ProjectsPage` is registered.

#### Typed route parameters

Optional. A page base class can type its route parameters from its `path`, so that an action reads `self.params().id` with the name checked. `onPage` stays the same; the type is the consumer's:

```ts
type RouteParams<Path extends string> =
  Path extends `${string}:${infer Name}/${infer Rest}`
    ? { [Key in Name | keyof RouteParams<Rest>]: string }
    : Path extends `${string}:${infer Name}`
      ? { [Key in Name]: string }
      : Record<never, string>;

@ayme({ present: onPage })
export abstract class AppPage<Path extends string = string> {
  abstract readonly path: Path;
  constructor(readonly page: Page) {}

  params(): RouteParams<Path> | undefined {
    const match = new URLPattern({ pathname: this.path }).exec(this.page.url());
    return match?.pathname.groups as RouteParams<Path> | undefined;
  }
}

export class ProjectPage extends AppPage<"/projects/:id"> {
  readonly path = "/projects/:id";
}
```

An app with a typed router calls the router's matcher from the predicate instead, with the same `self`.

### Page Object root

`root` is a root predicate, `(self) => Locator | Promise<Locator>` (`RootPredicate`). The Locator it answers names the Page Object Root.

- The Page Object is present while the Locator resolves to one rendered element.
- The page state marks that element with the Page Object's class.
- Every tool of the class takes that element's Structural Ref as `ref`.
- Availability is measured at that element.

Each action is published once per class, however many instances the page shows. Take a component base class, `AppComponent`, whose `root` is the element a component is built on. `ProjectRow` extends it, and `ProjectsPage` holds one `ProjectRow` per list item:

```ts
const rootOf = (self: AppComponent) => self.root;

@ayme({ root: rootOf })
export abstract class AppComponent {
  constructor(readonly root: Locator) {}
}

export class ProjectRow extends AppComponent {
  @ayme.child
  readonly removeButton = this.root.getByRole("button", { name: "Remove" });

  @ayme.action
  async remove() {
    await this.removeButton.click();
    return this;
  }

  @ayme.action
  async rename(name: string) {
    // ...
  }
}

export class ProjectsPage extends AppPage {
  readonly path = "/projects";
  readonly rows = this.page.getByRole("listitem");

  @ayme.child
  readonly searchbox = this.page.getByRole("searchbox");

  @ayme.collection
  async projects(): Promise<ProjectRow[]> {
    return (await this.rows.all()).map((row) => new ProjectRow(row));
  }

  @ayme.action
  async search(query: string) {
    await this.searchbox.fill(query);
  }
}
```

The page state marks each row's root with its class, in place of its role:

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
    - e13 button "Remove"
```

There is one `ProjectRow.remove` tool for both rows. Your code calls it through the session that [`createAyme`](#createayme) returns. Create it in your app's entry file, apart from the models, so its name does not clash with the `ayme` decorator:

```ts
// main.ts
import { createAyme } from "@ayme-dev/ayme";
import { ProjectsPage } from "./pages";

const ayme = createAyme({ pageObjects: [ProjectsPage] });
ayme.start();
```

A rooted class's tool takes two inputs. `ref` is the Structural Ref of the instance's root. `args` holds the action's arguments:

```ts
await ayme.tools.run("ProjectRow.remove", { ref: "e10" }); // removes Q4 survey
await ayme.tools.run("ProjectRow.rename", {
  ref: "e6",
  args: { name: "Launch plan v2" },
});
```

Leave out `args` when the action takes no input. A rooted page or single child is called the same way as a collection item.

A `ref` that is not a `ProjectRow` root is refused before anything runs:

```text
RefResolutionError: Cannot call ProjectRow.remove on ref "e5": it is not a root of ProjectRow.
```

`ProjectsPage` declares no `root`, because `AppPage` gives it only `present`. A root-less class's tool takes the action's arguments directly, with no `ref`:

```ts
await ayme.tools.run("ProjectsPage.search", { query: "web" });
```

Two instances of one class whose roots are the same element count as one instance.

`AppComponent` declares the predicate as its own function to type `self`. A Locator declared `@ayme.child` that resolves to the root's element is the root, not a child. The model lists it once.

A root predicate that throws makes the Page Object absent. The console gets the error with the instance's path, such as `ProjectRow at ProjectsPage.projects[0]: its root predicate threw TypeError: frame is undefined.`

#### Root-less models

Only the `root` option anchors a model. A model whose class chain declares no `root` option is root-less, even when it has a member named `root`. To anchor it, give the option to the model or to its base class.

A root-less model has no mark in the page state. Its tools are never unavailable because something covers it. Its presence depends on where it sits:

| Root-less model                               | Present while                                     |
| --------------------------------------------- | ------------------------------------------------- |
| Registered, without `present`                 | It is registered.                                 |
| A single Page Object Child, without `present` | The Page Object it is reached through is present. |
| Either of the above, with `present`           | The presence predicate returns `true`.            |

A root-less class has no `ref`, so it must be reached from exactly one declared member. A class two pages both declare needs a root. So does a collection item, and every Page Object Child below it. [Troubleshooting](../troubleshooting.md#a-page-object-has-no-tools) shows the error you get otherwise.

### Action availability

`available` is an availability predicate, `(self) => boolean | string | Promise<boolean | string>` (`AvailabilityPredicate`), where `self` is the live Page Object instance. `true` means the action can run now. A string means it cannot, and the string is its Availability Reason. `false` means it cannot, with no reason.

The predicate runs during the runtime's observation of the page, the same read-only probe that checks Page Object Roots. It never runs when the action is called. It must not scroll, click, focus or change the page.

It runs once for each present instance. It is skipped for an instance whose root a click would not reach, because that instance is already unavailable.

Give `remove` on `ProjectRow` from [Page Object root](#page-object-root) a predicate. A row shows its Remove button only to an admin of that project:

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

Declaring the predicate as its own function types `self`. One predicate can be given to several actions.

The user is an admin of Launch plan but not of Q4 survey, so only Launch plan's row has a Remove button:

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

- `ayme.tools.list()` lists `ProjectRow.remove` with `available: true`, because Launch plan passes.
- `ayme.tools.run("ProjectRow.remove", { ref: "e6" })` removes Launch plan.
- `ayme.tools.run("ProjectRow.remove", { ref: "e10" })` is refused before anything runs, with Q4 survey's reason: `RuntimeStateError: ProjectRow on ref "e10" is unavailable: Only admins can remove projects.`
- If no row passed, the tool would be listed with `available: false` and the first failing row's reason.

A predicate that throws makes the action unavailable. The error's text, such as `TypeError: store is undefined`, becomes the reason. Without `available`, an action is available while its Page Object is: its root is present and a click would reach it. The build plugin does not read the predicate. The decorator keeps it at runtime.

Availability never adds or withdraws a tool. [`ayme.tools`](#aymetools) says how an unavailable tool is listed and refused.

### Action descriptions

An agent reads an action's description, then the Page Objects the action returns. Say `ProjectsPage` has an action that opens a `NewProjectDialog`:

```ts
export class NewProjectDialog extends AppComponent {
  readonly createButton = this.root.getByRole("button", { name: "Create" });
}

export class ProjectsPage extends AppPage {
  readonly path = "/projects";

  @ayme.child
  readonly newProjectButton = this.page.getByRole("button", {
    name: "New project",
  });

  @ayme.child
  readonly newProjectDialog = new NewProjectDialog(
    this.page.getByRole("dialog")
  );

  @ayme.action({ description: "Opens the form for a new project." })
  async openNewProjectDialog(): Promise<NewProjectDialog> {
    await this.newProjectButton.click();
    return this.newProjectDialog;
  }
}
```

| `description` given                   | What agents get                                                  |
| ------------------------------------- | ---------------------------------------------------------------- |
| `"Opens the form for a new project."` | `Opens the form for a new project. Then shows NewProjectDialog.` |
| none                                  | `Shows NewProjectDialog.`                                        |

An action that may return one of several Page Objects names them all, joined by `or`. An action that returns its own class, as `ProjectRow.remove` does, names none. This text is the tool's `agentDescription` in [`ayme.tools.list()`](#toolinfo).

An action that has no description and returns no other Page Object has no description at all. WebMCP needs one, so it publishes `Run <method>.`, such as `Run remove.` for `ProjectRow.remove`.

## createAyme

`createAyme(options?)` creates a session, of type `Ayme`.

| Option            | Type                                                                | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pageFactory`     | `() => Page`                                                        | Builds the browser Page the session drives. Called at most once, lazily, on first use in the browser, never during server rendering. Defaults to `createPage()`.                                                                                                                                                                                                                                                                                   |
| `ignore`          | `ElementFilter`: a CSS selector, or `(page: Page) => Locator`       | Drops matching elements and their descendants from the Structural Page State. A function is called once, on `start()`, with the session's Page, and its Locator is resolved again before each capture. See [Page state](../guides/page-state.md).                                                                                                                                                                                                  |
| `customTools`     | `CustomTool[]`                                                      | Operations on one element. See [Custom Tools](../guides/custom-tools.md).                                                                                                                                                                                                                                                                                                                                                                          |
| `pageObjects`     | `PageObjectConstructor[]`                                           | Page Object classes registered for the session's lifetime, one [`pom.register`](#aymepom) each when the session is created. See [Register Page Objects](../guides/publish-tools.md#register-page-objects).                                                                                                                                                                                                                                         |
| `goalLoop`        | `GoalLoopDecisionFunction`                                          | [Experimental](experimental-apis.md). The decision function the Goal Loop calls, usually `decisionEndpoint(url)`. The `goal` tool exists only when it is set. See [Goals with Jev](../guides/goals-with-jev.md).                                                                                                                                                                                                                                   |
| `webMCP`          | `AymeWebMcpOptions`                                                 | `{ enabled, toolNamePrefix }`. See [Publish tools](../guides/publish-tools.md).                                                                                                                                                                                                                                                                                                                                                                    |
| `inspector`       | `boolean \| { placement?: "inline" \| "external"; demo?: boolean }` | Turns on the [Inspector](../guides/inspector.md) when the session starts in the browser. Off unless set. See [Inspector placement](#inspector-placement).                                                                                                                                                                                                                                                                                          |
| `navigate`        | `(url: string) => unknown`                                          | Your client router's navigation, which the [`navigate` Browser Tool](browser-tools.md) calls instead of loading a new document. See below.                                                                                                                                                                                                                                                                                                         |
| `agentConnection` | `boolean \| { link?: string; port?: number }`                       | Lets a coding agent's Ayme MCP server pair with the session and call its tools while it is started: in the browser, the page; in Node, the process, as an App Process beside the page. Loads the optional `@ayme-dev/mcp` package on demand, so install it beside `@ayme-dev/ayme`. Off unless set. For an App Process, `link` (a connect link from `ayme_connect`) names one server, and `port` looks on that one port only; a page ignores both. |

`ignore`, `customTools`, `goalLoop` and `navigate` take effect on `start()` and are cleared when the session stops.

With `navigate`, the `navigate` tool moves through your router, so your app keeps its in-memory state. The function gets the absolute URL of a page on the document's own origin; the tool refuses other origins, and protocols other than `http:` and `https:`, before calling it. When it returns a promise, the tool waits for it and ignores its value, then waits for a Settled Page and answers with the Change Record; a rejection fails the call. If it starts a full load after all, the call answers as a [full page load](../guides/page-state.md#full-page-loads). A router that takes a path, such as Vue Router, gets the URL without its origin:

```ts
navigate: (url) => router.push(url.slice(location.origin.length)),
```

`ayme.start()` makes the session the owner of the place it runs and turns on what its options ask for, and returns the function that stops it. In the browser that place is the document; in a Node process it is the process, which the session runs as its App Process (see [In Node](#in-node)). Each has one owner at a time: a start while the document or the process already has one throws a `RuntimeStateError` with `code: "active-owner"`; once that owner stops, a session can start again. The sessions the framework integrations create to render on the server never own anything: their `start()` starts nothing, so server rendering needs no guard and never conflicts with the process's App Process.

### Inspector placement

| `inspector`                               | Where the Inspector shows                                                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `true`, `{}` or `{ placement: "inline" }` | A panel in the page. It loads the optional `@ayme-dev/inspector` package on demand.                                                                                                                          |
| `{ placement: "external" }`               | In a [window of its own](../guides/inspector.md#in-a-window-of-its-own), which `ayme mcp` serves. The page mounts no panel. It serves the Inspector over its Agent Connection, and turns that connection on. |

Add `demo: true` to either object for [demo mode](../guides/inspector.md#demo-mode).

## ayme.tools

`ayme.tools` (`AymeTools`) reaches every tool by its unprefixed name, whether or not WebMCP publishes it.

Presence decides whether a Page Object Tool is listed. It is listed while any instance of its class is on the page. Availability decides whether a listed tool would run. An unavailable tool stays listed with `available: false`. Each consumer treats it like this:

| Consumer                             | An unavailable tool is                        |
| ------------------------------------ | --------------------------------------------- |
| WebMCP publication, Agent Connection | Published. A call is refused with its reason. |
| Goal Loop                            | Not offered.                                  |
| Inspector                            | Shown dimmed, with its reason.                |

| Member                      | Behavior                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run(name, input, { by }?)` | Runs the tool as a Run for the Caller `by` names, `"app"` by default, the way an agent's call runs it. Browser Tools resolve with an `ActionResult`, except `generate_locator`, which resolves with its locators; `snapshot` with a `PageContextPayload`, `goal` with a `Handover`. Page Object Tools and Custom Tools resolve with an action result, typed `unknown`. |
| `list()`                    | Every tool, in publication order, as [`ToolInfo`](#toolinfo) objects. Returns the same array until the list changes, and `[]` while the session is not started.                                                                                                                                                                                                        |
| `subscribe(listener)`       | Calls `listener` with the new list after it changes: the session starts or stops, a class is registered for the first time or unregistered for the last, a Page Object appears on the page or leaves it, a tool becomes available or unavailable or its reason changes, or a Peek Tool appears or goes. Returns the function that unsubscribes.                        |

`run` checks a call in this order. Nothing runs until every check passes. Child Runs are checked the same way.

| Check                                                                          | Fails with                                                                |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `by` is not empty, and the session is started.                                 | `RuntimeStateError`                                                       |
| A tool has the name.                                                           | `RuntimeStateError`: `There is no tool "<name>".`                         |
| The input matches the tool's input schema. Leaving `input` out counts as `{}`. | `ToolInputError`, naming every problem. See [Errors](errors.md#messages). |
| A rooted tool's `ref` is a root of its class.                                  | `RefResolutionError`                                                      |
| The tool, or the instance `ref` names, is available.                           | `RuntimeStateError`, with the reason.                                     |

Errors from the browser Page pass through unchanged. `BuiltInTools` maps each built-in tool name to its input and result. `ToolInput<Name>` and `ToolResult<Name>` read them.

Every Caller starts its Runs through `run`: WebMCP publication as `"webmcp"`, the Ayme MCP server's page client as `"ayme-mcp"`, and your code as `"app"` unless it passes another name, such as `{ by: "support-assistant" }` for an in-app assistant. A Caller name is any non-empty string; use lowercase kebab-case, which is not enforced. `callers` holds the built-in names (`callers.app`, `callers.webmcp`, `callers.aymeMcp`, `callers.inspector`); `BuiltInCaller` is one of them, and `Caller` is any name. Each Caller name has its own Change Record cursor, the page that Caller last received, so a Run's Change Record starts at its Caller's own last page: `changes_before` up to the action, `changes` from there; two Callers under one name share one cursor.

Runs take turns: the page runs one at a time, in the order they were started, whatever their Callers. An action's turn ends once the page has settled, so the next Run starts from a Settled Page; a read (`snapshot`, a Peek Tool) waits its turn but adds no settle wait. A failed Run ends its turn like any other.

A tool starts other tools through the `run` it is handed, never through `ayme.tools.run`. In a [Custom Tool](../guides/custom-tools.md#use-other-tools-from-a-custom-tool):

```ts
async execute({ ref }, { run }) {
  await ayme.tools.run("click", { target: ref }); // never resolves: it waits for this tool's turn to end
  await run("click", { target: ref }); // a child Run, inside this tool's turn
}
```

A child Run never waits on the page's queue. A parent's child Runs run one after the other, in the order it starts them. So two started together never act on the page at once. The `goal` tool runs each step's tool as a child Run of the goal Run.

### ToolInfo

`ayme.tools.list()` has this entry for `ProjectsPage.openNewProjectDialog` from [Action descriptions](#action-descriptions):

```ts
{
  name: "ProjectsPage.openNewProjectDialog",
  authorDescription: "Opens the form for a new project.",
  agentDescription: "Opens the form for a new project. Then shows NewProjectDialog.",
  inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  group: "pageObject",
  available: true,
  className: "ProjectsPage",
  returnPoms: ["NewProjectDialog"],
}
```

| Field               | Value                                                                                                                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`              | The unprefixed tool name.                                                                                                                                                                                                                                      |
| `authorDescription` | What the tool's author wrote. Absent when there is none.                                                                                                                                                                                                       |
| `agentDescription`  | The text Ayme's own adapters give agents. Hand this one to an agent of your own. On a Page Object Tool it adds the Page Objects the page shows afterwards; see [Action descriptions](#action-descriptions). On every other tool it equals `authorDescription`. |
| `inputSchema`       | The JSON Schema of the input. A rooted class's tools take `ref` and `args`; see [Page Object root](#page-object-root).                                                                                                                                         |
| `group`             | `"browser"`, `"custom"`, `"pageObject"`, `"peek"` or `"agent"`.                                                                                                                                                                                                |
| `available`         | Whether `run` can run it now. Only a Page Object Tool can be `false`. That happens while its Page Object is unavailable, or while its [availability predicate](#action-availability) fails for every instance.                                                 |
| `reason`            | The Availability Reason, when the tool is unavailable and has one. See [Availability Reasons](#availability-reasons).                                                                                                                                          |
| `className`         | Page Object Tools only: the declaring class.                                                                                                                                                                                                                   |
| `returnPoms`        | Page Object Tools only: the other Page Objects the action may return. Absent when there are none.                                                                                                                                                              |

When no row shows a Remove button, the `ProjectRow.remove` entry from [Action availability](#action-availability) has `available: false, reason: "Only admins can remove projects"`.

### Availability Reasons

A `reason` comes from one of two places.

**The runtime** writes one when the Page Object Root is on the page but a click would not reach it. Say the New project dialog is open and covers the list from [Action availability](#action-availability). The agent's latest page state shows:

```text
- e1:
  - e2 main:
    - e3 heading "Projects" [level=1]
    - e4 button "New project"
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
  - e14 dialog "New project":
    - e15 textbox "Project name"
    - e16 button "Create"
    - e17 button "Cancel"
```

The dialog covers both rows. So `ayme.tools.list()` has `{ name: "ProjectRow.remove", available: false, reason: "a click would not reach it; e14 is in the way", … }`. A call on Launch plan is refused with `ProjectRow on ref "e6" is unavailable: a click would not reach it; e14 is in the way.`

The ref names what the click would hit instead:

| What blocks the root   | The ref names                                                               |
| ---------------------- | --------------------------------------------------------------------------- |
| An element covering it | The covering element, or its nearest ancestor with a ref: here, the dialog. |
| An open native modal   | The modal.                                                                  |
| An `inert` ancestor    | That ancestor.                                                              |

The ref comes from the agent's latest page state. Sometimes no page state has shown that element yet, or nothing in the way has a ref, such as with `pointer-events: none` on `body`. Then the reason is just `a click would not reach it`. The reason never names a kind of widget, such as a modal, popover or banner.

**Your predicate** produces every other reason: the string the action's [availability predicate](#action-availability) returned, or the text of an error it threw.

## ayme.runs

`ayme.runs` (`AymeRuns`) is the document's Run log: the Runs started through `ayme.tools.run`, by any Caller, each listed once its turn starts, and the child Runs a tool starts, each listed after the Run that started it. An App Process tool the Inspector runs from the page is listed too, as an `"inspector"` Run; it acts on no page, so it takes no turn.

| Member                | Behavior                                                                                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list()`              | The newest 200 top-level Runs with their child Runs, oldest first, as `Run` objects; an older top-level Run is dropped with its children. Returns the same array until a Run starts, gains an Interaction, or ends. A new document starts an empty log. |
| `subscribe(listener)` | Calls `listener` with the new list when a Run starts, gains an Interaction, or ends. Returns the function that unsubscribes.                                                                                                                            |

A `Run` is one tool call in the log. Say your code removes Launch plan from [Action availability](#action-availability) with `await ayme.tools.run("ProjectRow.remove", { ref: "e6" })`. The action clicks the Remove button, `e9`. The last entry of `ayme.runs.list()` is then:

```ts
{
  id: "1",
  tool: "ProjectRow.remove",
  input: { ref: "e6" },
  by: "app",
  status: "succeeded",
  result: { page_changed: true, settled: true, changes: "…" },
  startedAt: 1794147726312,
  durationMs: 388,
  interactions: [{ operation: "click", locator: "…", ref: "e9" }],
}
```

| Field          | Value                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| `id`           | Unique within the document.                                                                             |
| `tool`         | The tool's unprefixed name.                                                                             |
| `input`        | The input, as JSON. Absent for `undefined`.                                                             |
| `by`           | Top-level Runs only: the Caller.                                                                        |
| `parent`       | Child Runs only: the `id` of the Run that started it. A child Run has no `by`.                          |
| `status`       | `"running"`, `"succeeded"` or `"failed"`.                                                               |
| `result`       | Succeeded Runs only: what the tool returned, as JSON captured when it returned. Absent for `undefined`. |
| `error`        | Failed Runs only: the error's message, prefixed with its name unless that is plain `Error`.             |
| `startedAt`    | Epoch milliseconds.                                                                                     |
| `durationMs`   | Absent while the Run is running.                                                                        |
| `interactions` | The Interactions the Run performed itself on the session's Page, in order.                              |

An `Interaction` is one input the Run gave the page. It is a click, fill, key press, hover or selection on an element, or a keyboard or mouse input.

| Field       | Value                                                                        |
| ----------- | ---------------------------------------------------------------------------- |
| `operation` | The method, such as `"click"`, or `"keyboard.press"` for the keyboard.       |
| `locator`   | The locator it acted on. Absent for the keyboard and the mouse.              |
| `ref`       | The element's Structural Ref before the input, when the page state knows it. |
| `value`     | The value it was given, such as a fill's text or a pressed key.              |

Waits, assertions, scrolls, focus changes and navigations are not Interactions. A child Run's Interactions are its own, not its parent's. So a `goal` Run lists none, and each step's child Run lists its own.

A failed Run is still recorded, and `run` still throws. A failed WebMCP call is still an error result. This includes a call whose tool does not exist or is unavailable, and one made while the session is not started. Only an empty `by` throws without recording a Run, because there is no Caller to record.

## ayme.pom

`ayme.pom` (`AymePom`) holds one Page Object of each Page Object Model for the session.

| Member              | Behavior                                                                                                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get(Model)`        | Returns the instance, created on first use. Safe during rendering: on the server it returns an inert object with the model's prototype and never calls `pageFactory`.                                                                                       |
| `register(Model)`   | Counts a registration and returns the instance. The class's tools are live while the session is started. Registrations made before `start()` take effect on start. On the server it registers nothing. See [Classes with one name](#classes-with-one-name). |
| `unregister(Model)` | Removes one registration. The tools are withdrawn when the last one is removed.                                                                                                                                                                             |

Every registration of a class shares one instance, so a Page Object should keep no per-component state in its own fields.

### Classes with one name

Ayme tells classes apart by name. Say `ProjectsPage` is registered, and its `accountMenu` child is the `AccountMenu` in `projects/AccountMenu.ts`. Now you register `SettingsPage`, whose `accountMenu` is a different `AccountMenu`, in `settings/AccountMenu.ts`. `SettingsPage` is not registered, and nothing throws. The console gets a `RuntimeStateError` with `code: "same-named-class"`, and `SettingsPage`'s tools are not listed. Once `ProjectsPage` is unregistered, `SettingsPage` is registered without another call.

## ayme.peek

> **Experimental:** this may change in any release. See [Experimental APIs](experimental-apis.md).

`ayme.peek(read, name, id?)` adds a Peek: a named view of app state that a coding agent reads on demand. It returns the function that removes it.

- `read` returns the values when an agent asks, and may be async. The values go out as JSON: a property whose value is `undefined` is left out, so the agent cannot tell it from one the Peek does not have; a `Date` becomes its ISO string; and an instance whose `read` returns `undefined` reads `null`.
- `name` is required; an empty name throws `RuntimeStateError`, and so does a name whose Peek Tool name another tool already uses, or, in the browser, a name starting with `node.`, whose tool would read as an App Process's. A tool that takes the name later wins, and the console warns that the Peek Tool is hidden. Each name has one Peek Tool, `peek.<name>` in the browser and `peek.node.<name>` in a Node process (an App Process), with characters outside `[A-Za-z0-9_.-]` replaced by `_`. It takes no input and returns `{ name, instances }`: per live instance, its `id` and either its `values` or the `error` its read threw.
- There is one instance per (`name`, `id`). A later call with the same `id` updates that instance's `read`. Without an `id` there is one instance per name, and a later call replaces the earlier one, so a module that runs again replaces its Peek.
- The tool goes when its last instance is removed. An instance removed and added again in one go, such as by React StrictMode's remount, keeps it.

Peek Tools are in `ayme.tools` and reach coding agents through the Agent Connection and the Inspector. WebMCP never publishes them, and the Goal Loop never offers them. A call answers at once, without waiting for a Settled Page. `ayme.peek` does nothing unless the session has `agentConnection` on, or `inspector` in the browser.

### What a Peek exposes

Through the Agent Connection, whatever `read` returns goes to the coding agent unchanged, and from the agent's context to its model provider, as a page snapshot does; the Inspector shows it to you. Ayme sends it nowhere else. A Peek is live only while the Agent Connection or the Inspector is on, which you turn on in development only; there is no production guard. `read` is where you decide what the agent sees: return only what you would paste into a chat with that provider. Pick the fields rather than handing over a whole record, and a class with a `toJSON` method controls its own shape:

```ts
ayme.peek(() => ({ id: user.id, name: user.name }), "user"); // not the whole user, with its email and token
```

### In Node

In Node, `start()` makes the session the process's App Process, unless a framework integration created the session to render a request. It needs no page, and the session's tools are its Peek Tools alone; with `agentConnection` the process pairs with the agent's Ayme MCP server beside the page. Without `agentConnection` the session still owns the process, but connects nothing and offers no Peeks. A process has one App Process, so start one session per process, once, in the server's entry point.

Peeks follow one rule on both sides: start the connection where the process starts, and define each Peek in the module that owns the state it reads. In the browser, that is the component, with your framework's Peek hook. In Node, it is the module that holds the state, or one next to it that the same code imports. The App Process offers the Peeks of every session in the process that has `agentConnection` on, so that module needs no started session: it creates its own with `agentConnection` on in development and calls `peek` on it. When a dev server evaluates the module again after an edit, its new `ayme.peek` call replaces the old instance, so the Peek reads the new code.

In Next.js, start the App Process in `instrumentation.ts`, which runs once when the server starts:

```ts
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV === "production") return;
  const { createAyme } = await import("@ayme-dev/ayme");
  createAyme({ agentConnection: true }).start();
}
```

Define the Peeks in a module that request code imports, such as one the root layout imports:

```ts
// app/server-peeks.ts, imported by app/layout.tsx
import { createAyme } from "@ayme-dev/ayme";
import { db } from "./db";

createAyme({
  agentConnection: process.env.NODE_ENV !== "production",
}).peek(async () => ({ users: await db.user.count() }), "users");
```

Do not add Peeks in `register()`. `next dev` never evaluates `instrumentation.ts` again, not even after you edit it, and the modules it imports get their own copies, apart from the ones pages, layouts and Server Actions use. A Peek added there reads that copy: state request code changed does not show in it, and after an edit to the module it reads, it keeps running the old code until `next dev` restarts. A Peek in request code reads the same modules the page does. After an edit, it runs the old code until the next request evaluates its module again, so load a page after editing server code.

In Nuxt, start it in a Nitro server plugin, as the [Nuxt example](https://github.com/ayme-labs/ayme/blob/main/apps/example-nuxt/README.md#peeks) does.

The process finds the agent's server the way a tab does: it pairs only when exactly one Ayme MCP server answers on the ports from 9350 to 9365. While unpaired it looks again every few seconds, and again when its server goes away, so a dev server started before the agent pairs once the agent is up. With several servers running, name one with `agentConnection: { link }` or `{ port }`. Read these from your own environment if you need them; Ayme reads none. Component Peeks register only after mount in the browser, so server rendering adds none to the process. While the tab is paired with that server too, its Inspector lists the process's Peek Tools in the Node section of its Peek tools and runs them through the server. The [`@ayme-dev/mcp` README](https://github.com/ayme-labs/ayme/blob/main/packages/mcp/README.md#app-processes) covers the pairing and what happens when two App Processes offer one name.

## ayme.webMCP

`ayme.webMCP` (`AymeWebMcp`) is the session's WebMCP publication.

| Member                | Behavior                                                                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `publicationStatus`   | `{ state, message }`. `state` is `disabled` (publication off), `waiting` (for a WebMCP driver), `active` (published), `unavailable` (no driver within two seconds), `failed` (such as `@ayme-dev/webmcp` not installed) or `disposed` (the session stopped). |
| `subscribe(listener)` | Calls `listener` with each new status. Returns the function that unsubscribes.                                                                                                                                                                               |
| `retryPublication()`  | Tries again after `unavailable` or `failed`. Pending attempts are shared, and an active publication is not repeated.                                                                                                                                         |

## createPage

`createPage(options?)` builds the browser Page the session drives by default. Its options are `testIdAttribute`, `actionTimeout` and `navigationTimeout`. Each one resolves on its own. The value you pass wins. Next come the Playwright settings the [build plugin](build-plugin.md) compiled in, then the built-in default. The built-in defaults are 1 second for `actionTimeout` and 30 seconds for `navigationTimeout`. `createPage()` with no options is the session's default Page. `actionTimeout` also bounds element reads such as `boundingBox`, so an action on a locator that matches nothing fails instead of waiting forever. Navigation keeps its own default whatever `actionTimeout` is; pass `navigationTimeout` to change it. Pass a factory as `pageFactory` to own page construction: without the Vite plugin, with a timeout that differs from your build, or wrapped in your own instrumentation. A wrapper must keep the locators the runtime observes.

```ts
createAyme({ pageFactory: () => createPage({ actionTimeout: 500 }) });
```

## decisionEndpoint

> **Experimental:** this may change in any release. See [Experimental APIs](experimental-apis.md).

`decisionEndpoint(url, options?)` returns a decision function for `goalLoop` that posts each `DecisionRequest` to your Decision Endpoint. It resolves function `headers`, passes `credentials`, and throws a `DecisionEndpointError` on a non-2xx response or a body that is not a decision response; its `code` says which. The [Decision Endpoint reference](decision-endpoint.md) has the route contract and `createDecisionEndpoint`.

## Errors

Ayme's own failures are `AymeError` subclasses: `ToolInputError`, `RefResolutionError`, `RuntimeStateError` and `DecisionEndpointError`. [Errors](errors.md) says what each means and lists the messages.
