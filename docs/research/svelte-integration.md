# Svelte and SvelteKit integration: conventions, proposed API and minimum versions

Research for #226 "Research Svelte integration conventions and minimum versions", part of the map #224 "Specify Svelte support for Ayme". Findings are recommendations until the approval ticket #228 records a decision.

Date: 2026-10-02. Author: Claude, for Abel.

## Summary

- **Package:** `@ayme-dev/svelte`, a plain TypeScript package with two functions, `useAyme` and `usePageObject`. It ships no `.svelte` components and imports only `setContext`, `getContext`, `onDestroy` and `svelte/store`, all public since Svelte 3.0.
- **Shape:** the Vue model, not the React one. Svelte, like Vue, runs a component's script once at initialisation and gives it context, so a function called in the root `+layout.svelte` (SvelteKit) or `App.svelte` (SPA) owns the runtime. No provider component is needed.
- **Return value:** `{ ayme, webMCP }`. `webMCP.publicationStatus` is a Svelte readable store, read as `$publicationStatus` in components of Svelte 3, 4 and 5.
- **Tested:** a throwaway adapter of this shape, over the packed Ayme packages of current main, passed a port of the Nuxt certification spec (JavaScript-disabled SSR HTML, hydration, real published schema, tool call, direct POM call, real Playwright POM call, unmount and remount, client navigation) on SvelteKit 1.0.0 + Svelte 3.54.0 + Vite 4.0.0, SvelteKit 2.0.0 + Svelte 4.0.0 + Vite 5.0.3, SvelteKit 2.9.0 + Svelte 5.0.0 + Vite 6.0.0, SvelteKit 2.70.3 + Svelte 5.57.1 + Vite 8.2.2 and SvelteKit 3.0.0 + Svelte 5.57.1 + Vite 8.2.2, in both `vite dev` and the adapter-node production server. SPA mode and a plain Svelte 5 + Vite SPA passed too.
- **Lowest justified candidate:** Svelte 3.54.0 with SvelteKit 1.0.0 and Vite 4.0.0, with one limitation: below Vite 6, editing a type a POM imports needs a dev-server restart (the plugin's invalidation needs Vite environments). Svelte 3, Svelte 4 and SvelteKit 1 no longer receive releases; the public promise is a decision for #228 (options below).
- **Setup findings that the proposal must encode:**
  1. SvelteKit 2 on Vite 8 does not lower POM decorators from `tsconfig.json`; it needs `oxc: { decorator: { legacy: true } }`, as the Nuxt fixture does. SvelteKit 3 and Vite 7 or older do not.
  2. The owner must live in a layout that is never swapped. SvelteKit creates the next layout before it destroys the previous one, so an owner in a route-group layout throws "already has an active owner" on navigation.
- **Cross-cutting finding, not Svelte-specific:** in a packed consumer on Vite 8, the plugin's build defines do not reach the pre-bundled `@ayme-dev/ayme` in `vite dev`. Under the #250 target this leaves only the Playwright settings (`testIdAttribute`, timeouts) silently ignored in development. It needs its own ticket on the build integration.

## Baseline and scope

- The ticket's preparation baseline was `95c789356823b1d146357b7c89079e7de51b6a92`. Current main is `a94a1590` "refactor!: rename the packages to the alpha names", which adds `2be0d447` (core publishing removed), `a94a1590` (package rename) and `e2de6236` (test-lane docs) on top. The packages already carry the alpha names (`@ayme-dev/ayme`, `@ayme-dev/vue`, `@ayme-dev/unplugin-ayme`). The decorators (`@WebMCP`), the setup names (`useAymeWebMcp`, `AymeWebMcpProvider`), the session options (`page`, `refTools`) and the plugin's `publish` option and define are still the old ones; #252, #253 and #254 carry those changes.
- The proposal is written against the #250 target. The probes had to run current code, so they use the current names. This table maps one to the other:

| Probes (current main)                                                      | Proposal (#250 target)                                                                                                  |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `@WebMCP`, `@WebMCP.tool(...)`                                             | `@ayme`, `@ayme.action(...)`                                                                                            |
| `createRuntimeSession({ page, refTools, ... })`                            | `createRuntimeSession({ pageFactory, customTools, ... })`                                                               |
| `aymeWebMcp({ publish: true })` and `__AYME_WEBMCP_PUBLISH__`              | `useAyme({ webMCP: { enabled: true } })`; no plugin option, no define                                                   |
| `session.getSnapshot()`, `session.subscribe()`, `session.retryPublication` | `session.webMCP.publicationStatus`, `session.webMCP.retryPublication`, and whatever subscription #253 gives that member |
| `AymeWebMcpPublicationStatus`                                              | the main library's status type after #253                                                                               |

- The Vite plugin's export name is not settled by #250, which only removes `publish`. Examples use the current `aymeWebMcp` and mark it.
- Two meanings of "adapter" appear below. **Ayme framework adapter** means `@ayme-dev/svelte`, the framework package that adapts the public runtime session (ADR-0025). **SvelteKit adapter** means a deployment adapter such as `@sveltejs/adapter-node`. The "adapter floor" in #226 is the first.

## How Svelte's lifetimes map to Ayme's contract

Facts below cite the Svelte 5.57.1 declarations (`svelte/types/index.d.ts`), its server entry (`svelte/src/index-server.js`), and the SvelteKit documentation.

| Ayme need                             | Svelte mechanism                                                                                                                                                                           | Since                                 | Notes                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One owner, visible to descendants     | `setContext(key, value)` in a component's script; `getContext(key)` in descendants                                                                                                         | 3.0                                   | Must be called during component initialisation. Context set in a component is also visible to `getContext` in that same component. SvelteKit's docs recommend `setContext` in a layout to share state with pages ("Using context to share state with child components", [state management](https://svelte.dev/docs/kit/state-management)).         |
| Start the runtime in the browser only | Component script runs on the server and in the browser; `typeof window` distinguishes them                                                                                                 | 3.0                                   | `onMount` does not run on the server, but it runs child-first, so a child's `onMount` would run before the owner's. Starting in the owner's script, guarded by `typeof window`, is what makes the runtime started when descendants mount (probe L1).                                                                                               |
| Cleanup                               | `onDestroy(fn)`                                                                                                                                                                            | 3.0                                   | The only lifecycle callback that also runs during server rendering (`index-server.js` registers it on the renderer). Cleanup must therefore be server-safe; the proposal only registers browser cleanup in the browser.                                                                                                                            |
| Reactive publication status           | Store contract: `subscribe(run)` calls `run` synchronously with the current value and returns an unsubscribe function; `$store` auto-subscribes in a component and unsubscribes on destroy | 3.0                                   | Stores are still supported in Svelte 5 and `$store` works in runes mode, but only for a store declared at the component's top level ([stores](https://svelte.dev/docs/svelte/stores)). The session's `subscribe` does not call the listener immediately, so the adapter wraps it with `readable(current, set => subscribe(() => set(current())))`. |
| Svelte-5-only alternatives            | `createSubscriber` (reactive getters, 5.7.0), `createContext` (typed context pair, 5.40.0), `fromStore` (store to rune object, 5.0.0)                                                      | 5.x                                   | Not needed. Using them would raise the floor to Svelte 5.7 or 5.40 for no capability gain.                                                                                                                                                                                                                                                         |
| Server render isolation               | Context is per render; module-level state is shared by all requests                                                                                                                        | —                                     | SvelteKit warns against shared server state ("Avoiding shared state on the server", [state management](https://svelte.dev/docs/kit/state-management)). Each render creates its own inert session through context; nothing is created at module scope.                                                                                              |
| Hydration                             | Hydration runs component scripts again in the browser                                                                                                                                      | 3.0 (`hydratable`), 5.0 (`hydrate()`) | The owner creates and starts the browser session; `usePageObject` constructs the real Page Object, as in the Nuxt fixture. Initial status depends only on options (`waiting` when publication is enabled, `disabled` otherwise), so server HTML and the first client render agree.                                                                 |
| Navigation                            | SvelteKit keeps a layout mounted while navigating between its child routes; it reuses a page component when only parameters change; it replaces a component when the route changes         | 1.0                                   | Page-owned Page Objects unregister on `onDestroy` when the route changes (probe L2). A reused page component keeps its Page Object, which is correct because the DOM it describes is the same component. An owner in a swapped layout fails (probe L3).                                                                                            |

Svelte 3/4 legacy syntax and Svelte 5 runes do not change the adapter. They change only consumer markup: `<slot />` versus `{@render children()}`, `on:click` versus `onclick`, `let` versus `$state`. Svelte 5 still compiles legacy-syntax components. The adapter is plain TypeScript, so one build serves all three majors. Shipping a `.svelte` provider would instead require the consumer's compiler to accept the component's syntax and would tie the package to one children API.

## Proposed API

### Package

`@ayme-dev/svelte`, matching `@ayme-dev/vue` and `@ayme-dev/react` and ADR-0029's framework-named packages. Its only dependency is `@ayme-dev/ayme`; `svelte` is a peer.

```json
{
  "name": "@ayme-dev/svelte",
  "exports": {
    ".": { "types": "./dist/index.d.mts", "import": "./dist/index.mjs" }
  },
  "dependencies": { "@ayme-dev/ayme": "<shared version>" },
  "peerDependencies": { "svelte": "see 'Support promise'" }
}
```

It is built with `tsdown` like the Vue and React packages. It needs no `svelte-package` step and no `svelte` export condition, because it contains no `.svelte` files.

### Exports

```ts
import type { Readable } from "svelte/store";
import type {
  AymeOptions, // the options type #253 gives createRuntimeSession
  AymePublicationStatus, // the status type #253 gives session.webMCP
  RuntimeSession,
} from "@ayme-dev/ayme";
import type { PageObjectConstructor } from "@ayme-dev/ayme/internal";

export type { AymeOptions, AymePublicationStatus };

export type AymeWebMCP = {
  /** Read with `$publicationStatus` in a component. */
  readonly publicationStatus: Readable<AymePublicationStatus>;
  retryPublication(): Promise<void>;
};

export function useAyme(options?: AymeOptions): {
  ayme: RuntimeSession;
  webMCP: AymeWebMCP;
};

export function usePageObject<T extends object>(
  model: PageObjectConstructor<T>
): T;
```

`AymeOptions` is `{ pageFactory?, ignore?, customTools?, goalLoop?, webMCP?: { enabled?, toolNamePrefix? } }`, identical to Vue, React and `createRuntimeSession` (#250). The adapter passes it to `createRuntimeSession` unchanged; it adds no option of its own.

### `useAyme(options?)`

Mirrors the Vue table in `packages/vue/README.md`, as ADR-0017 asks.

| Call                                                                                                        | Behaviour                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useAyme(options)` or `useAyme()` with no ancestor owner                                                    | Creates a session with `options`. In the browser, starts it immediately during initialisation and stops it in `onDestroy`. On the server, never starts it. Puts it in context. Returns `{ ayme, webMCP }`.                                                    |
| `useAyme()` beneath an owner                                                                                | Returns the owner's `{ ayme, webMCP }`; starts and stops nothing.                                                                                                                                                                                             |
| `useAyme(options)` beneath an owner                                                                         | Throws `Error("Configure Ayme on the ancestor useAyme(options) owner, not beneath it.")`.                                                                                                                                                                     |
| A second owner in another subtree, or an owner in a layout swapped on navigation, while the first is active | The session's `start()` throws `RuntimeStateError("The Ayme runtime already has an active owner.")`. The adapter rethrows it as `RuntimeStateError("useAyme(options) already has an active owner. Call it once, in the root +layout.svelte or App.svelte.")`. |
| Called outside component initialisation (a `load` function, `+layout.ts`, an event handler, module scope)   | Svelte throws its own error from `getContext` (`lifecycle_outside_component` in Svelte 5, "Function called outside component initialization" in 3 and 4). The adapter adds no check.                                                                          |

Options are read once. A Svelte script runs once per component instance, so there is no prop to watch and no "options must stay fixed" check. To change options, remount the owner, which in practice means reloading.

Context is visible inside the owner's own component, so the owner and `usePageObject` may share a component, as Vue's standalone setup allows.

### `webMCP`

`webMCP` is the session's `webMCP` member made reactive the Svelte way (#250 "made reactive in the framework's own way"):

- `publicationStatus` is a readable store of the same frozen status object the session exposes: states `disabled`, `waiting`, `active`, `unavailable`, `failed`, `disposed`. It subscribes to the session when its first subscriber arrives and unsubscribes after its last, so a destroyed component leaves no listener.
- `retryPublication` is the session's function, unchanged.

The `$` prefix needs a top-level variable, so components destructure:

```svelte
<script lang="ts">
  import { useAyme } from "@ayme-dev/svelte";
  const { webMCP: { publicationStatus, retryPublication } } = useAyme();
</script>

<p>Publication: {$publicationStatus.state}</p>
{#if $publicationStatus.state === "unavailable"}
  <button onclick={retryPublication}>Retry</button>
{/if}
```

In a Svelte 5 `.svelte.ts` module, `fromStore(publicationStatus).current` gives a rune-backed value.

**Alternative considered:** a reactive getter object (`webMCP.publicationStatus.state` read directly) built on `createSubscriber`. It reads more like Vue's ref, but only works from Svelte 5.7, and only in runes-aware code. The store works in every major and is the convention SvelteKit itself used for `$app/stores`. Recommended: the store.

### `usePageObject(Model)`

| Situation                        | Behaviour                                                                                                                                                                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser, owner present           | Returns `ayme.construct(Model)`, the concrete Page Object, and registers it; `onDestroy` removes the registration. A remount creates a new instance.                                                                                            |
| Server, owner present            | Returns the session's inert object with `Model`'s prototype, as Vue and React do. Rendering may reference action methods in event handlers; it must not read locators or constructor-initialised fields or call actions. Nothing is registered. |
| No owner                         | Throws `Error("usePageObject requires useAyme() in an ancestor component, such as the root +layout.svelte.")`. Unlike Vue, there is no standalone fallback; Vue keeps it only for backward compatibility.                                       |
| Outside component initialisation | Svelte's own error, as for `useAyme`.                                                                                                                                                                                                           |

Constructors must only initialise fields and compose locators. Actions run later, for example in an event handler or `onMount`. The runtime is already started in a descendant's `onMount` (probe L1).

### SvelteKit SSR setup

```ts
// vite.config.ts (SvelteKit 2)
import { sveltekit } from "@sveltejs/kit/vite";
import { aymeWebMcp } from "@ayme-dev/unplugin-ayme/vite"; // export name unsettled by #250
import { defineConfig } from "vite";

export default defineConfig({
  // Needed on Vite 8 only: SvelteKit 2's tsconfig chain does not reach oxc.
  oxc: { decorator: { legacy: true } },
  plugins: [sveltekit(), aymeWebMcp()],
});
```

```ts
// vite.config.ts (SvelteKit 3: configuration lives in the plugin call)
import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { aymeWebMcp } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit({ adapter: adapter() }), aymeWebMcp()],
});
```

```jsonc
// tsconfig.json: keep SvelteKit's generated base and add the decorator flag
{
  "extends": "./.svelte-kit/tsconfig.json", // SvelteKit 3: "$app/tsconfig" with "include": ["src", "test", "*"]
  "compilerOptions": { "experimentalDecorators": true },
}
```

```ts
// src/lib/pom/CounterPage.ts
import { ayme } from "@ayme-dev/ayme";
import type { Locator, Page } from "@playwright/test";

@ayme
export class CounterPage {
  readonly incrementButton: Locator;

  constructor(page: Page) {
    this.incrementButton = page.getByRole("button", {
      name: "Increment",
      exact: true,
    });
  }

  @ayme.action({ description: "Increment the counter." })
  async increment() {
    await this.incrementButton.click();
  }
}
```

```svelte
<!-- src/routes/+layout.svelte: the root layout, never a route-group layout -->
<script lang="ts">
  import { useAyme } from "@ayme-dev/svelte";
  import { decisionEndpoint } from "@ayme-dev/ayme";

  let { children } = $props();
  useAyme({
    webMCP: { enabled: true },
    goalLoop: decisionEndpoint("/api/ayme/decide"),
  });
</script>

{@render children()}
```

```svelte
<!-- src/routes/Counter.svelte -->
<script lang="ts">
  import { usePageObject } from "@ayme-dev/svelte";
  import { CounterPage } from "$lib/pom/CounterPage";

  let count = $state(0);
  const pom = usePageObject(CounterPage);
</script>

<section aria-label="Counter">
  <p>Count: <output>{count}</output></p>
  <button onclick={() => (count += 1)}>Increment</button>
  <button onclick={() => pom.increment()}>Call Page Object</button>
</section>
```

Svelte 3 and 4 use the same script code with legacy markup: `<slot />` in the layout, `let count = 0` and `on:click`.

Running a goal from the application uses the session directly: `const { ayme } = useAyme(); await ayme.pursueGoal(goal, { maxSteps: 8 })` (the method name follows #250 and #253).

The same root `useAyme` works with `export const ssr = false` (SvelteKit SPA mode, probe P2) and with prerendering's HTML output, which is ordinary server rendering. Prerendering itself was not probed.

### Svelte SPA setup (no SvelteKit)

```ts
// vite.config.ts
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { aymeWebMcp } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [svelte(), aymeWebMcp()] });
```

```ts
// src/main.ts (Svelte 5; Svelte 3 and 4 use `new App({ target })`)
import { mount } from "svelte";
import App from "./App.svelte";

mount(App, { target: document.getElementById("app")! });
```

`App.svelte` calls `useAyme(...)` exactly like the root layout above. A plain `tsconfig.json` that includes `src` with `experimentalDecorators: true` is enough on every Vite version probed, including Vite 8 (probe P3).

### Build integration

The existing Vite plugin is reused unchanged. Verified per item:

| Item                        | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Evidence                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Plugin order                | The plugin declares `enforce: "pre"` and transforms only `.ts` modules, so it runs before Svelte's plugin regardless of array order and never sees `.svelte` files. Probes used `[sveltekit(), aymeWebMcp()]`; the reverse order was not run.                                                                                                                                                                                                                                                                                                                       | `packages/unplugin-ayme/src/index.ts`; probes |
| Decorated `.ts` POMs        | Compiled in the browser graph: the published schema matched the POM source in every probe. POMs must be `.ts` modules; decorators inside `.svelte` scripts are not compiled (same rule as Vue).                                                                                                                                                                                                                                                                                                                                                                     | probes K1–K5                                  |
| SSR transform               | The plugin skips its POM transform when `ssr` is set, so the server imports the decorated class without manifest registration. The decorators must still be lowered for Node.                                                                                                                                                                                                                                                                                                                                                                                       | `vite.ssr.test.ts`; probes                    |
| Decorator lowering          | Vite ≤7 (esbuild) reads `experimentalDecorators` through SvelteKit's tsconfig chain. Vite 8 (oxc) does not when the root `tsconfig.json` inherits `include` from `.svelte-kit/tsconfig.json`: the server responded 500 with "Invalid or unexpected token" on the untransformed `@WebMCP`. The same file was lowered once `include` was declared in the root config, and SvelteKit 3's root-level `include` works without the `oxc` option. Fix for SvelteKit 2 on Vite 8: `oxc: { decorator: { legacy: true } }`. Standard (non-legacy) decorators were not probed. | probe K4 transform dump                       |
| Publication define          | Removed by #250. On current code, SvelteKit externalises `@ayme-dev/ayme` in SSR and Vite 8 pre-bundles it in dev, so the define never reached it: server and client both reported `disabled`. The probes added `ssr.noExternal` and `optimizeDeps.exclude` for current code only. Under the target, publication comes from runtime options and needs neither.                                                                                                                                                                                                      | probe K4                                      |
| Playwright settings defines | Reach the client production bundle (`testIdAttribute` replaced in `.svelte-kit/output/client`). Do **not** reach the pre-bundled runtime in `vite dev` on Vite 8 with a packed install: `node_modules/.vite/deps/runtime-*.js` still contains `typeof __AYME_PLAYWRIGHT_TEST_ID_ATTRIBUTE__`. Not Svelte-specific: any packed Vite consumer is affected; workspace-linked examples are not pre-bundled and so hide it. The server never builds a Page, so SSR externalisation is harmless.                                                                          | probe K4 grep                                 |
| tsconfig for the compiler   | The compiler followed SvelteKit 2's `extends` chain and SvelteKit 3's `$app/tsconfig` without a separate `tsconfig.pom.json`. POMs outside `src` (for example a `playwright/` folder) would need one, as in the Nuxt fixture.                                                                                                                                                                                                                                                                                                                                       | probes K4, K5                                 |
| Dependency invalidation     | Editing a type a POM imports rebuilds its schema without restarting `vite dev` on Vite 6.0.0 and 8.2.2. It does not on Vite 4.0.0 and 5.0.3, as `index.ts` notes ("Vite before 6 has no environments").                                                                                                                                                                                                                                                                                                                                                             | probes K1–K5 incremental spec                 |
| Built package exports       | Every probe installed `pnpm pack` tarballs of `@ayme-dev/ayme`, `@ayme-dev/unplugin-ayme` and `@ayme-dev/inspector` through pnpm overrides, as the packed-consumer test does. No workspace aliases.                                                                                                                                                                                                                                                                                                                                                                 | probe setup                                   |

## Options and contracts

| Contract                                  | Svelte mapping                                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `pageFactory`                             | Passed to the session; called once, lazily, in the browser. Never on the server.                               |
| `ignore`                                  | Passed to the session; configured on start, cleared on stop.                                                   |
| `customTools`                             | Passed to the session.                                                                                         |
| `goalLoop`                                | Passed to the session; `ayme.pursueGoal` uses it.                                                              |
| `webMCP.enabled`, `webMCP.toolNamePrefix` | Passed to the session; `webMCP.publicationStatus` starts `disabled` when off.                                  |
| `{ ayme, webMCP }`                        | `ayme` is the session; `webMCP` wraps the session's `webMCP` member as a store plus retry.                     |
| One active owner                          | Enforced by the session; the adapter improves the message and documents "root layout only".                    |
| Registration cleanup and remount          | `onDestroy` per component; a remount constructs a new instance (probe K-series remount and navigation checks). |
| Server render isolation                   | Context per render; the session is never started on the server; nothing at module scope.                       |

## Version and API history

Dates are npm publish dates (`npm view <pkg> time`); peer ranges are `npm view <pkg>@<version> peerDependencies engines`.

| Release                                   | Date       | Peers / engines                                                                               | Relevance to Ayme                                                                                                                                                                                                |
| ----------------------------------------- | ---------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Svelte 3.0.0                              | 2019-04-21 | —                                                                                             | `setContext`, `getContext`, `onDestroy` (runs on the server), `svelte/store`: every API the adapter uses.                                                                                                        |
| Svelte 3.54.0                             | 2022-12-06 | —                                                                                             | Floor of vite-plugin-svelte 2 and SvelteKit 1.                                                                                                                                                                   |
| Svelte 3.x last: 3.59.2                   | 2023-06-20 | —                                                                                             | No release since.                                                                                                                                                                                                |
| Svelte 4.0.0                              | 2023-06-22 | —                                                                                             | Floor of SvelteKit 2 and vite-plugin-svelte 3. Same legacy syntax as 3.                                                                                                                                          |
| Svelte 4.x last: 4.2.20                   | 2025-05-20 | —                                                                                             | Most recent Svelte 4 release.                                                                                                                                                                                    |
| Svelte 5.0.0                              | 2024-10-19 | —                                                                                             | Runes, snippets, `mount`/`hydrate`; stores and legacy syntax still supported.                                                                                                                                    |
| Svelte 5.7.0                              | 2024-12-05 | —                                                                                             | `createSubscriber` (not used).                                                                                                                                                                                   |
| Svelte 5.40.0                             | 2025-10-14 | —                                                                                             | `createContext` (not used).                                                                                                                                                                                      |
| Svelte 5.57.1                             | 2026-09-18 | —                                                                                             | Current; floor of SvelteKit 3.                                                                                                                                                                                   |
| SvelteKit 1.0.0                           | 2022-12-14 | vite ^4, svelte ^3.54, node ≥16.14                                                            | Lowest SSR toolchain.                                                                                                                                                                                            |
| SvelteKit 1.30.4 (last 1.x)               | 2024-02-16 | vite ^4, svelte ^3.54 ‖ ^4                                                                    | No release since.                                                                                                                                                                                                |
| SvelteKit 2.0.0                           | 2023-12-14 | vite ^5.0.3, svelte ^4 ‖ ^5, vite-plugin-svelte ^3, node ≥18.13                               | Drops Svelte 3.                                                                                                                                                                                                  |
| SvelteKit 2.9.0                           | 2024-11-29 | adds vite ^6                                                                                  | First with Vite 6, so first with Ayme's dev invalidation.                                                                                                                                                        |
| SvelteKit 2.22.0                          | 2025-06-20 | adds vite ^7                                                                                  | —                                                                                                                                                                                                                |
| SvelteKit 2.53.0                          | 2026-02-20 | adds vite ^8                                                                                  | —                                                                                                                                                                                                                |
| SvelteKit 2.70.3 (latest 2.x)             | 2026-08-18 | vite ^5.0.3 – ^8, svelte ^4 ‖ ^5, typescript ^5.3.3 ‖ ^6                                      | Current 2.x.                                                                                                                                                                                                     |
| SvelteKit 3.0.0                           | 2026-10-01 | vite ^8.0.12, svelte ^5.57.1, vite-plugin-svelte ^7, typescript ^6, node ≥22.17               | Released the day before this research. `svelte.config.js` is no longer read (configuration moves into `sveltekit({...})`, available since 2.62), `$lib` becomes `#lib`, `tsconfig.json` extends `$app/tsconfig`. |
| vite-plugin-svelte 2 / 3 / 4 / 5 / 6 / 7  | —          | vite ^4 / ^5 / ^5 / ^6 / ^6.3 ‖ ^7 / ^8; svelte ^3.54 ‖ ^4 / ^4 ‖ ^5 / ^5 / ^5 / ^5 / ^5.46.4 | Svelte 4 cannot run on Vite 6 or later.                                                                                                                                                                          |
| unplugin 3.4.0 (Ayme's plugin dependency) | —          | node ^20.19 ‖ ≥22.12                                                                          | A tooling floor independent of Svelte.                                                                                                                                                                           |

### Floors, kept apart

| Floor                              | Value                                                                                                                                 | Basis                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Ayme framework adapter API         | Svelte 3.0.0                                                                                                                          | Only 3.0 APIs are used. Not run below 3.54.0.                                         |
| SvelteKit SSR toolchain            | SvelteKit 1.0.0 ⇒ Svelte ≥3.54.0, Vite ^4                                                                                             | SvelteKit's own peers.                                                                |
| Svelte SPA toolchain               | vite-plugin-svelte 2 ⇒ Svelte ≥3.54.0, Vite ^4                                                                                        | Older vite-plugin-svelte 1 (Svelte ^3.44, Vite 3) was not probed.                     |
| Ayme Vite plugin, compilation      | Vite 4.0.0 runs it                                                                                                                    | Probe K1. The plugin's declared Vite floor belongs to #220/#222.                      |
| Ayme Vite plugin, dev invalidation | Vite 6.0.0                                                                                                                            | Probes K1–K3; source comment.                                                         |
| Node                               | ≥20.19 (unplugin 3) and the SvelteKit major's engines                                                                                 | npm metadata. Probes ran Node 24.12.0.                                                |
| Upstream maintenance               | Svelte 3 last released 2023-06, SvelteKit 1 last released 2024-02, Svelte 4 last released 2025-05; SvelteKit 3 requires Svelte 5.57.1 | npm publish history; this is evidence of activity, not an official support statement. |

### Support promise (decision for #228)

The lowest candidate justified by owning sources and probes is **Svelte 3.54.0 with SvelteKit 1.0.0 and Vite 4.0.0**. Supporting it costs no adapter code. It costs one legacy-syntax certification fixture, which Svelte 4 needs anyway, run at old versions. Options:

1. **`svelte: "^3.54.0 || ^4.0.0 || ^5.0.0"` (recommended).** Matches what runs. Document that below Vite 6 a POM type edit needs a dev-server restart. Certify Kit 1.0/Svelte 3.54/Vite 4.0 and Kit 2.0/Svelte 4.0/Vite 5.0 as minima, Kit 2.9/Svelte 5.0/Vite 6.0 as the invalidation floor, and current Kit 2 and Kit 3 as current.
2. **`^4.0.0 || ^5.0.0`.** Drops versions without releases since 2023. Saves one CI job; the code is the same.
3. **`^5.0.0`.** Only maintained majors. Allows a runes-native `webMCP` (`createSubscriber`, from 5.7). Excludes applications still on Svelte 4, which SvelteKit 2.x keeps supporting.

The adapter's peer range and the Vite floor of `@ayme-dev/unplugin-ayme` are separate promises. If #222 sets that plugin's floor above Vite 4 or 5, option 1's minima move with it without changing the adapter.

## Certification matrix

Proposed checks, not results. Modelled on `apps/example-nuxt` and `apps/example-next`: one example app per row group, Playwright specs that observe published tools through `@ayme-dev/ayme/testing`, run against development and the production server.

| Check                                                                                                      | SPA (Svelte + Vite) | SSR dev (`vite dev`) | SSR prod (adapter-node) |
| ---------------------------------------------------------------------------------------------------------- | ------------------- | -------------------- | ----------------------- |
| JavaScript-disabled HTML on two requests: Counter rendered, status `waiting`                               | —                   | ✓                    | ✓                       |
| No page errors, no hydration warnings                                                                      | ✓                   | ✓                    | ✓                       |
| Status reaches `active` with the recording driver                                                          | ✓                   | ✓                    | ✓                       |
| Published schema of `CounterPage.increment` equals the POM source                                          | ✓                   | ✓                    | ✓                       |
| `executePublishedTool`, the hook's POM and `new CounterPage(page)` each change the count                   | ✓                   | ✓                    | ✓                       |
| Unmount removes the tool; remount restores it with a fresh instance                                        | ✓                   | ✓                    | ✓                       |
| Client navigation away and back unregisters and re-registers the page's POM; the root owner stays `active` | —                   | ✓                    | ✓                       |
| Descendant `onMount` sees a started runtime                                                                | ✓                   | ✓                    | ✓                       |
| `webMCP.enabled: false` keeps status `disabled` and publishes nothing while the POM still works            | ✓                   | ✓                    | ✓                       |
| `toolNamePrefix` prefixes the published name                                                               | ✓                   | ✓                    | ✓                       |
| Editing a type a POM imports rebuilds its schema without restart                                           | ✓ (Vite ≥6)         | ✓ (Vite ≥6)          | —                       |
| Packed-consumer install of `@ayme-dev/svelte` type-checks with `svelte-check`                              | ✓                   | —                    | —                       |

| Column                       | Minimum                                                                                           | Current                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| SvelteKit SSR, legacy syntax | Kit 1.0.0, Svelte 3.54.0, Vite 4.0.0 (option 1) or Kit 2.0.0, Svelte 4.0.0, Vite 5.0.3 (option 2) | —                                                   |
| SvelteKit SSR, runes         | Kit 2.9.0, Svelte 5.0.0, Vite 6.0.0                                                               | Kit 3.x and latest Kit 2.x, Svelte 5 latest, Vite 8 |
| Svelte SPA                   | same Svelte/Vite minimum as the chosen option                                                     | Svelte 5 latest, Vite 8                             |

Adapter unit tests (Vitest, `svelte/server` `render` and a jsdom `mount`) cover what the browser seam cannot see: the `{ ayme, webMCP }` value, the ownership table, the error messages, the store's subscribe/unsubscribe, the server path that never starts, and the `disabled` status.

## Alternatives considered

| Alternative                                                          | Why not recommended                                                                                                                                                                                                        |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<AymeProvider>` component plus `useAyme()` (React shape)            | Needs a `.svelte` file, so the package must ship Svelte source compiled by the consumer, and its children API differs between `<slot>` (3/4) and snippets (5). It adds nothing a script call in the root layout cannot do. |
| `setAyme(options)` / `getAyme()` pair (common Svelte library naming) | Idiomatic in Svelte libraries, but diverges from the Vue and React names without a lifecycle reason; ADR-0017 prefers matching names. Worth a sentence in the README for Svelte readers.                                   |
| Start in `onMount` instead of during initialisation                  | Would let a swapped layout own the runtime, but a descendant's `onMount` runs first and would see a stopped runtime. Root-only ownership keeps the simpler rule.                                                           |
| Runes-only reactive `webMCP` (`createSubscriber`)                    | Raises the floor to Svelte 5.7 for template sugar.                                                                                                                                                                         |
| A SvelteKit-specific package or `handle` hook                        | Ayme never runs on the server, and the root layout already exists in every SvelteKit app. Importing `$app/*` would break the plain SPA.                                                                                    |
| Let the Vite plugin inject startup                                   | Rejected by ADR-0030 and ADR-0016.                                                                                                                                                                                         |

## Probes

All probes ran on 2026-10-02 inside `devbox run` with the repository's Devbox (Node 24.12.0, pnpm 11.24.0), against packed tarballs built from `a94a1590`:

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@ayme-dev/ayme --filter=@ayme-dev/unplugin-ayme --filter=@ayme-dev/inspector
for p in ayme unplugin-ayme inspector; do (cd packages/$p && pnpm pack --pack-destination "$TARBALLS"); done
# in each probe app (pnpm-workspace.yaml overrides the three packages to the tarballs):
pnpm install --no-lockfile
pnpm exec playwright test                                   # vite dev
pnpm exec vite build && PROBE_MODE=prod pnpm exec playwright test   # adapter-node server
```

| Probe | Versions (resolved)                                                                           | SSR dev | SSR prod | Rebuild on type edit             | Notes                                                                                                                                                                                                      |
| ----- | --------------------------------------------------------------------------------------------- | ------- | -------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1    | Kit 1.0.0, Svelte 3.54.0, vite-plugin-svelte 2.0.0, Vite 4.0.0, adapter-node 1.0.0, TS 4.9.4  | pass    | pass     | **fail** (expected below Vite 6) | Legacy syntax.                                                                                                                                                                                             |
| K2    | Kit 2.0.0, Svelte 4.0.0, vite-plugin-svelte 3.0.0, Vite 5.0.3, adapter-node 2.0.0, TS 5.3.3   | pass    | pass     | **fail** (expected below Vite 6) | Legacy syntax.                                                                                                                                                                                             |
| K3    | Kit 2.9.0, Svelte 5.0.0, vite-plugin-svelte 5.0.0, Vite 6.0.0, adapter-node 5.0.1, TS 5.6.3   | pass    | pass     | pass                             | Svelte 5.0.0 fails to compile a TypeScript parameter annotation inside a `.svelte` arrow function ("Not implemented type annotation EmptyStatement"); removed from the probe component. Unrelated to Ayme. |
| K4    | Kit 2.70.3, Svelte 5.57.1, vite-plugin-svelte 7.3.1, Vite 8.2.2, adapter-node 5.5.7, TS 6.0.3 | pass    | pass     | pass                             | Needs `oxc.decorator.legacy`. Also passed in SPA mode (`ssr = false`), dev and prod (P2). One first run after a config change failed at "waiting"; not reproduced in three further cold runs.              |
| K5    | Kit 3.0.0, Svelte 5.57.1, vite-plugin-svelte 7.3.1, Vite 8.2.2, adapter-node 6.0.0, TS 6.0.3  | pass    | pass     | pass                             | `vite.config.ts` configuration, `#lib`, `$app/tsconfig`; no `oxc` option needed.                                                                                                                           |
| P3    | Plain Svelte 5.57.1 + vite-plugin-svelte 7.3.1 + Vite 8.2.2, `mount()`                        | —       | —        | —                                | SPA spec passed under `vite` and `vite preview`.                                                                                                                                                           |
| L1    | (in K1–K5) child `onMount` calls `ayme.pursueGoal` without a `goalLoop`                       | —       | —        | —                                | The error names the missing `goalLoop`, not a stopped session, so the runtime is started before a descendant mounts.                                                                                       |
| L2    | (in K1–K5) navigate `/` → `/other` → `/`                                                      | —       | —        | —                                | Tool unpublished and republished; owner stays `active`; POM usable after return.                                                                                                                           |
| L3    | Kit 2.70.3: owners in `(a)/+layout.svelte` and `(b)/+layout.svelte`, navigate `/a` → `/b`     | fail    | —        | —                                | `RuntimeStateError: The Ayme runtime already has an active owner.` from the `(b)` owner; navigation does not complete.                                                                                     |

What the probes do not prove: the probe adapter is a prototype over current names, not the production package; no prefix or `enabled: false` run (those options do not exist on current main); no Safari or Firefox; no prerendering, edge runtime, streaming or `+page.server.ts` actions; no Svelte below 3.54.0; no TypeScript type-check of a consumer importing the adapter on old TypeScript versions (#220 owns the TypeScript floor).

<details>
<summary>Probe adapter (<code>src/lib/ayme-svelte.ts</code>)</summary>

```ts
// Throwaway probe of the proposed @ayme-dev/svelte shape over the current
// public session. Only public `svelte` exports that exist since Svelte 3.0.
import { getContext, onDestroy, setContext } from "svelte";
import { readable, type Readable } from "svelte/store";
import {
  createRuntimeSession,
  type AymeRuntimeOptions,
  type AymeWebMcpPublicationStatus,
  type RuntimeSession,
} from "@ayme-dev/ayme";
import type { PageObjectConstructor } from "@ayme-dev/ayme/internal";

const key = Symbol("Ayme runtime");
const inBrowser = typeof window !== "undefined";

export type AymeWebMcp = {
  publicationStatus: Readable<AymeWebMcpPublicationStatus>;
  retryPublication(): Promise<void>;
};

export function useAyme(options?: AymeRuntimeOptions): {
  ayme: RuntimeSession;
  webMCP: AymeWebMcp;
} {
  const inherited = getContext<RuntimeSession | undefined>(key);
  if (inherited && options)
    throw new Error(
      "Configure Ayme on the ancestor useAyme(options) owner, not beneath it."
    );
  let ayme = inherited;
  if (!ayme) {
    ayme = createRuntimeSession(options);
    // Start during component initialisation so descendants' onMount, which
    // runs before the owner's, already sees a started runtime.
    if (inBrowser) onDestroy(ayme.start());
    setContext(key, ayme);
  }
  const session = ayme;
  return {
    ayme: session,
    webMCP: {
      publicationStatus: readable(session.getSnapshot(), (set) =>
        session.subscribe(() => set(session.getSnapshot()))
      ),
      retryPublication: session.retryPublication,
    },
  };
}

export function usePageObject<T extends object>(
  model: PageObjectConstructor<T>
): T {
  const ayme = getContext<RuntimeSession | undefined>(key);
  if (!ayme)
    throw new Error(
      "usePageObject requires useAyme() in an ancestor component, such as the root +layout.svelte."
    );
  const instance = ayme.construct(model);
  if (inBrowser) onDestroy(ayme.register(model, instance));
  return instance;
}
```

</details>

<details>
<summary>K4 <code>vite.config.ts</code> and the K1/K2 differences</summary>

```ts
import { sveltekit } from "@sveltejs/kit/vite";
import { aymeWebMcp } from "@ayme-dev/unplugin-ayme/vite";
import { defineConfig } from "vite";

export default defineConfig({
  // SvelteKit's tsconfig chain does not reach oxc; lower POM decorators here.
  oxc: { decorator: { legacy: true } },
  // Current code only: let the plugin's build defines reach the runtime package
  // in the dev optimizer and the SSR graph.
  optimizeDeps: { exclude: ["@ayme-dev/ayme"] },
  ssr: { noExternal: ["@ayme-dev/ayme"] },
  plugins: [sveltekit(), aymeWebMcp({ publish: true })],
});
```

K1–K3 drop the `oxc` line (Vite ≤7 uses esbuild). K1 and K2 use `svelte.config.js` with `vitePreprocess()` (from `@sveltejs/kit/vite` in Kit 1, from `@sveltejs/vite-plugin-svelte` in Kit 2) and legacy markup: `<slot />`, `let count = 0`, `on:click`. K5 moves the adapter into `sveltekit({ adapter: adapter() })` and removes `svelte.config.js`.

Transform dump that located the decorator failure (K4, before the `oxc` line):

```text
=== ssr
const __vite_ssr_import_0__ = await __vite_ssr_import__("@ayme-dev/ayme", {"importedNames":["WebMCP"]});
@__vite_ssr_import_0__.WebMCP class CounterPage {
```

</details>

<details>
<summary>Integration spec (port of <code>apps/example-nuxt/tests/integration.spec.ts</code>)</summary>

```ts
import { expect, test } from "@playwright/test";
import {
  executePublishedTool,
  publishedToolNames,
  publishedToolSchema,
  recordPublishedTools,
} from "@ayme-dev/ayme/testing";
import { CounterPage } from "../src/lib/pom/CounterPage";

const ssr = process.env.PROBE_SSR !== "off";

test.describe("server render", () => {
  test.skip(!ssr, "SPA mode renders no server HTML");
  test.use({ javaScriptEnabled: false });

  test("returns the Ayme subtree on repeated requests", async ({ page }) => {
    for (let request = 0; request < 2; request += 1) {
      const response = await page.goto("/");
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("region", { name: "Counter" })).toBeVisible();
      await expect(page.locator("output")).toHaveText("0");
      await expect(
        page.getByRole("status", { name: "Publication" })
      ).toHaveText("Publication: waiting");
    }
  });
});

test("hydrates, publishes, executes, cleans up on remount and navigation", async ({
  context,
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || /hydrat/i.test(message.text()))
      errors.push(message.text());
  });
  await recordPublishedTools(context);

  await page.goto("/");
  await expect(page.getByRole("status", { name: "Publication" })).toHaveText(
    "Publication: active",
    { timeout: 15_000 }
  );
  await expect(page.getByTestId("started")).toHaveText(
    "Runtime at child mount: started"
  );
  await expect
    .poll(() => publishedToolSchema(page, "CounterPage.increment"))
    .toEqual({
      name: "CounterPage.increment",
      description: "Increment the counter.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    });

  await page.getByRole("button", { name: "Call Page Object" }).click();
  await expect(page.locator("output")).toHaveText("1");
  await executePublishedTool(page, "CounterPage.increment");
  await expect(page.locator("output")).toHaveText("2");
  await new CounterPage(page).increment();
  await expect(page.locator("output")).toHaveText("3");

  await page.getByRole("button", { name: "Unmount counter" }).click();
  await expect(page.getByRole("region", { name: "Counter" })).toHaveCount(0);
  await expect
    .poll(() => publishedToolNames(page))
    .not.toContain("CounterPage.increment");
  await page
    .getByRole("button", { name: "Mount counter", exact: true })
    .click();
  await expect
    .poll(() => publishedToolNames(page))
    .toContain("CounterPage.increment");
  await expect(page.locator("output")).toHaveText("0");

  // Client-side navigation: the layout keeps the owner, the page's POM goes.
  if (process.env.PROBE_NAV !== "off") {
    await page.getByRole("link", { name: "Other" }).click();
    await expect(
      page.getByText("Other page without Page Objects.")
    ).toBeVisible();
    await expect
      .poll(() => publishedToolNames(page))
      .not.toContain("CounterPage.increment");
    await page.getByRole("link", { name: "Home" }).click();
    await expect
      .poll(() => publishedToolNames(page))
      .toContain("CounterPage.increment");
    await expect(page.getByRole("status", { name: "Publication" })).toHaveText(
      "Publication: active"
    );
    await page.getByRole("button", { name: "Call Page Object" }).click();
    await expect(page.locator("output")).toHaveText("1");
  }
  expect(errors).toEqual([]);
});
```

The incremental spec is `apps/example-next/tests/incremental.spec.ts` with the path changed to `src/lib/pom/CounterMode.ts` and a `setMode(mode: CounterMode)` action added to the POM.

</details>

## Follow-ups before approval

No runnable unknown blocks the proposal. Items the implementation tickets must carry:

1. **Build integration, outside Svelte:** make the plugin's Playwright settings reach the runtime in `vite dev` for packed consumers on Vite 8 (probe K4), or move those settings to runtime options. Verify on a packed Vue or React consumer too. Proposed as its own ticket.
2. **Decorator lowering on Vite 8:** decide whether the plugin should set `oxc.decorator.legacy` itself, which would remove the step from SvelteKit 2 and Nuxt setups, and whether standard decorators lower on oxc at all.
3. **Implementation order:** (a) `@ayme-dev/svelte` with unit tests, after #253 lands the session's `webMCP` member; (b) `apps/example-sveltekit` (SSR dev and prod, Kit 2 current, runes) with the matrix above; (c) the minimum fixtures for the option #228 chooses; (d) the Svelte SPA example or an SPA-mode project in the SvelteKit example; (e) README, packed-consumer test entry and the shipped `ayme` skill.

## Sources

- npm registry metadata for `svelte`, `@sveltejs/kit`, `@sveltejs/vite-plugin-svelte`, `@sveltejs/adapter-node`, `vite`, `unplugin`, fetched 2026-10-02 with `npm view`.
- `svelte@5.57.1`: `types/index.d.ts` (`onMount`, `onDestroy`, `setContext`, `getContext`, `createContext`, `readable`, `fromStore`) and `src/index-server.js` (`onDestroy` on the server, `onMount` a no-op).
- `@sveltejs/kit@3.0.0`: `types/index.d.ts` (`sveltekit(config)`, configuration in Vite since 2.62) and `src/messages/build-errors.js` (`config_file_unsupported`, `module_removed_lib`, `tsconfig_extends_missing`).
- Svelte docs: [Stores](https://svelte.dev/docs/svelte/stores). SvelteKit docs: [State management](https://svelte.dev/docs/kit/state-management).
- Ayme: `packages/ayme/src/runtime.ts`, `packages/ayme/src/registry.ts`, `packages/vue/src/index.ts`, `packages/react/src/index.ts`, `packages/unplugin-ayme/src/index.ts`, `apps/example-nuxt`, `apps/example-next`, ADR-0006, ADR-0016, ADR-0017, ADR-0025, ADR-0029, and the #250 approved ADR-0030 text.
