# Inspector

How to turn on the Inspector, the in-page panel that shows your Page Objects, the page state and the tools, and lets you run them by hand.

## Turn it on

Install `@ayme-dev/inspector` beside `@ayme-dev/ayme`, which declares it as an optional peer dependency:

```sh
npm install -D @ayme-dev/inspector
```

Then pass `inspector: true` where Ayme starts: `useAyme` or `AymeProvider` in Vue, `AymeProvider` in React, `useAyme` in Svelte, `provideAyme` in Angular, or `createAyme`. Most apps turn it on in development only:

```ts
useAyme({ inspector: import.meta.env.DEV });
```

- The option is off unless set, and there is no production guard: you decide when it is on.
- While it is on, the session loads the Inspector when it starts in the browser, mounts it, and unmounts it when it stops. Server rendering loads nothing.
- With the option off, the page requests no Inspector code.
- If the package cannot be loaded, the error names `@ayme-dev/inspector`.
- The Inspector reaches Page Objects constructed before it loaded.
- It works whether WebMCP publication is on or off.
- It turns the page's [Peeks](../reference/ayme.md#aymepeek) on, as `agentConnection` does.

## Demo mode

To show people what an agent does, pass `inspector: { demo: true }`:

```ts
useAyme({ inspector: { demo: true } });
```

Demo mode pauses briefly before each action and shows a cue where each click lands. It applies to every call while it is on, whether it comes from the panel, an agent or WebMCP. `inspector: true` turns the Inspector on without it, so calls run at full speed; Runs records them either way.

## The three lenses

The navigator has three lenses:

- **Model**: the Page Objects on the page and the Page Object Models it knows, with their members' states.
- **Structure**: the Structural Page State an agent receives, each node tagged with the member it maps to.
- **Tools**: every tool of the page, grouped as Page object, Custom, Browser, Peek and Agent tools. A Page Object Tool that cannot run now shows dimmed, with its reason under its name; Run stays enabled, so you can check the refusal. Peek tools lists the page's [Peeks](../reference/ayme.md#aymepeek) under Browser and, while the tab is paired with a coding agent's Ayme MCP server, those of the App Processes paired beside it under Node, which the panel runs through that server.

Selecting anything opens its detail. A tool's page and a structure node's detail also show what the model sees of them: the definitions, page state and schemas an agent gets.

## Running tools

Every detail runs its tools through the same run card, a form typed from the tool's input schema, with an item picker for collection tools and the last result. **Runs** lists every Run on the page, whoever started it: you from the panel, an agent, or the app. Each shows its Caller, its arguments, its result, which can be copied, and the Interactions it performed, such as clicks and fills, named by the Page Object member they acted on. The Runs a Run started sit under it: a goal Run shows the Runs its steps executed, and a Custom Tool the Runs it started, each with its own Interactions.

## The panel

The panel floats, docks to the left, right or bottom of the page, or collapses to the Ayme logo. It remembers its layout, sizes, positions and theme per site in the page's `localStorage`, and uses its defaults when storage is unavailable. Within a tab, it also keeps the open lens, the selection, the Runs region and the newest 50 runs in `sessionStorage`, so a reload comes back to them. A selected structure node goes back to the page, because its ref can name another element after a reload. Its theme follows the system until you change it. While docked, it pads the page's root on that side so the panel sits beside the page.

It paints above the page's own UI; only the browser's top layer, such as modal dialogs, popovers and fullscreen, covers it. Outside the panel and the collapsed logo, the page keeps its pointer. When an agent's pointer action targets something under the panel, the action passes through it.

## What it never changes

The Inspector keeps its view live without recording anything an agent would see, so it never changes the page state, the Change Records or the interaction history an agent gets.

It lives in a closed Shadow Root on an `<ayme-inspector>` element at the end of the body. Its styles stay inside it, and no locator on the page, Playwright's or Ayme's, sees inside it, so a Page Object member never matches the Inspector's own text. The page state capture leaves the Inspector out. It bundles its own React, so a host app of any framework or React version never shares it.
