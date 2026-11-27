# Troubleshooting

The common reasons an ayme setup fails, by what you see.

## The build fails

- **`Unsupported Page Object Tool input type for …`**: an action takes a parameter type the compiler cannot describe, such as a function or a class instance. [Page Object Models](guides/ayme-page-objects.md#aymeaction) lists the supported types. When the type is an import, check that the tsconfig the message names resolves it, for example through its `paths`. A build without ayme does not fail on it; see [Include ayme in a build](reference/build-plugin.md#include-ayme-in-a-build).
- **`Page Object Action … needs a name for every element of …`**, **`… takes two input fields named …`** or **`… have no type`**: a destructured parameter cannot be published as it is: an array pattern skips or nests an element or leaves a tuple element unbound, two input properties share a name, or an object pattern binds a name its type does not have, as an unannotated one does. See [Page Object Models](guides/ayme-page-objects.md#aymeaction). A build without ayme does not fail on these.
- **`<file>: Could not find a tsconfig.json for this module.`**: the Page Object Model is outside every tsconfig. Add one, or pass `tsconfigPath` to the [build plugin](reference/build-plugin.md).
- **Angular's `maximumError` budget fails**, or **Vite warns about a chunk over 500 kB**: ayme adds about 290 kB transferred to the initial chunk. Raise the `initial` budget; see [Angular](frameworks/angular.md#bundle-size). A build includes ayme only with the plugin's `include: true`; see [Include ayme in a build](reference/build-plugin.md#include-ayme-in-a-build).
- **`ayme was removed from this build. <Model>.<action> is not in it.`**: the app called a Page Object in a build without ayme, one without the plugin's `include: true`. Set it for builds whose own code drives Page Objects; see [Include ayme in a build](reference/build-plugin.md#include-ayme-in-a-build).
- **`Unsupported Playwright config loader version …`**: loading a Playwright config through `playwright.config` needs `@playwright/test` 1.62 to 1.64. Remove `config` and pass `use` values directly, or upgrade.

## A Page Object has no tools

- **`<Class> has no compiler-derived ayme metadata`**: the build plugin did not compile the class. Check that it is marked `@ayme`, lives in a `.ts` file the app imports, and that `experimentalDecorators` is on. On Vite 8 with your own `oxc` or `esbuild` settings, see the [build plugin reference](reference/build-plugin.md#vite). A subclass in a file without `@ayme` needs a bundler content filter that matches it; see [What it compiles](reference/build-plugin.md#what-it-compiles).
- **The tool is not in `ayme.tools.list()`**: the class is not registered, or its Page Object is not present: its [presence predicate](reference/ayme.md#page-object-presence) answers `false` for the current URL, or its [Page Object Root](reference/ayme.md#page-object-root) is not on the page. A page registered at setup is present only where its `present` says so, and a model declares its root with the decorator's `root` option, on its own class or a base class; a member named `root` alone anchors nothing. A predicate that throws makes the Page Object absent and logs the error. When the console shows `Cannot register the Page Object "<name>": …`, two different classes with one name are reachable, such as an `AccountMenu` in `projects/AccountMenu.ts` and another in `settings/AccountMenu.ts`. The message names both files. Rename one of the classes.
- **The console shows `The Page Object class "<name>" declares no root and …`**: that class has no `root` and more than one instance. Two registered pages may both declare it, or it may sit below a collection. Its tools are withheld; the other classes keep theirs. Give the class a `root`.
- **The tool is listed with `available: false`**: its `reason` says why. `a click would not reach it; dialog "Delete" is in the way` names the element a click would hit instead of the Page Object Root by its role and accessible name, such as an open dialog. `a click would not reach it` alone means nothing in the way has a role to name it by, such as a plain `div` overlay. Any other string is what the action's [availability predicate](guides/ayme-page-objects.md#aymeaction) returned, or the text of an error it threw. No reason means the predicate returned `false`. See [Availability Reasons](reference/ayme.md#availability-reasons).
- **A Svelte decorator in a `.svelte` file is ignored**: Page Object Models must be `.ts` modules.
- **Editing a type an action uses does not change its schema** with Angular: reload the page.

## The agent cannot reach the page

These are for a coding agent that runs your Page Object Tools with the `ayme` command, as [Connect an agent](guides/connect-an-agent.md) sets up.

- **`No Session is open in <folder>.`**, or **`No Session named <name> is open in <folder>.`**: no Session runs in that folder under that name. When other Sessions run there, the message goes on with their names: `The Sessions open there are named: …`. Start one with `ayme open` or `ayme attach`, in the project's folder and with the same `-s=<name>` as the command, or use the name of one that runs. `ayme list` prints `No Session is open in <folder>.` too, as its answer rather than an error, when the folder has none.
- **`npx ayme` has no `open`, `attach` or `page-objects`**: the project also has `@ayme-dev/mcp`, whose command is also called `ayme`, and `npx` ran that one. Uninstall it, as [Set up your project](guides/connect-an-agent.md#set-up-your-project) says.
- **The Session does not start, and names a package**: the project has no `@ayme-dev/ayme`, has it at another version than `@ayme-dev/cli`, or has no Playwright, or one older than the range [Connect an agent](guides/connect-an-agent.md#set-up-your-project) gives. Install the version the message names; for Playwright, one in that range.
- **`<folder> has no ayme/page-objects.ts.`**: list your Page Object classes there; see [Connect an agent](guides/connect-an-agent.md#set-up-your-project).
- **`The Page Objects of … did not build:`**: the build error follows. Fix it, then start the Session again. A Session builds your Page Objects only when it starts, so start it again after every edit.
- **A Page Object's tools are missing**: its class is not listed in `ayme/page-objects.ts`, and no listed class reaches it; or it is not present on the Tab ayme works on. The first line of `ayme page-objects` names that Tab: the browser's most recently active one.
- **`ayme attach` fails with `Timeout 30000ms exceeded`**: Chrome answers no new connection while a dialog is open in one of its pages. Answer the dialog with the browser automation, then run `ayme attach` again. Connect the automation before an action can open a dialog, so it can answer it.
- **`No tab is open in the Session's browser.`**: open one with the browser automation.
- **`ayme open` cannot start Chromium**: install it for the project's Playwright with `npx playwright install chromium`.

## A Peek Tool is missing

These are for [Peeks](reference/ayme.md#aymepeek), which reach a coding agent through ayme's MCP server and the Inspector only.

- **No `peek.<name>` tool**: `ayme.peek` does nothing unless the session has `agentConnection` on, or `inspector` in the browser. A component's Peek appears once the component has mounted, and goes when its last instance unmounts. An agent that does not follow tool-list changes finds it with `ayme_list_tools`.
- **No `peek.node.<name>` tool**: in Node, only `agentConnection` turns Peeks on, and the process must have started its session and paired. It pairs by itself only when exactly one ayme MCP server answers on the ports from 9350 to 9365; with several running, name one with `agentConnection: { link }` or `{ port }`. See [In Node](reference/ayme.md#in-node).
- **A `peek.node.<name>` in Next.js answers with old code, or misses what request code changed**: the Peek was added in `instrumentation.ts`, which `next dev` evaluates once, with its own copies of the modules it imports. Add it from a module request code imports. See [In Node](reference/ayme.md#in-node).
- **`[ayme] peek.<name> is hidden: another tool uses that name.`**: another of the page's tools took the Peek Tool's name, and keeps it. Rename the Peek.
- **`[ayme] peek.node.<name> is hidden: another App Process offers a tool with the same name.`**, in the process's terminal: two App Processes offer one name, and the one that connected first keeps it.
- **`The Peek "node.<name>" would be read through peek.node.<name>, which names an App Process's Peek.`**: a Peek in the browser has a name starting with `node.`. Rename it.

## In-browser agents see no tools

These are for agents that run in the browser and read the tools ayme publishes through WebMCP.

- **The publication status is `disabled`**: pass `webMCP: { enabled: true }` where ayme starts. See [Publish tools](guides/publish-tools.md).
- **`ayme was removed from this build, but setup enables WebMCP publication.`** in the console: setup passes `webMCP: { enabled: true }`, but the build left ayme out, so the session is inert, its publication status stays `disabled` and no tool is published. Set the [build plugin](reference/build-plugin.md)'s `include: true` for the build that publishes tools.
- **The status is `unavailable`**: no WebMCP driver appeared within two seconds. Load the polyfill or enable Chrome's flag before your app's entry module, as [Publish tools](guides/publish-tools.md#give-the-page-webmcp) shows, or call `retryPublication()` once it is there.
- **The status is `failed`**: `@ayme-dev/webmcp` is not installed beside `@ayme-dev/ayme`, or the WebMCP driver rejected a registration. The message says which.
- **The status is `active` but no tool is published**: two tools share a name, such as a Custom Tool named like a Page Object Tool, which leaves `ayme.tools.list()` empty. `ayme.tools.run` throws the error that names the tool.
- **The tools have unexpected names**: `webMCP.toolNamePrefix` is set, and agents see the prefixed names.

## ayme starts twice

- **`The ayme runtime already has an active owner`**, or a framework's nested-owner error: start ayme once, at the app's root. In a Node process, start one session, in the server's entry point. In SvelteKit, only the root `+layout.svelte` may call `useAyme(options)`; in Angular, put `provideAyme` in the application config, not in route providers.

[Errors](reference/errors.md) lists every message with its cause.
