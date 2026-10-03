# A unified `ayme` decorator and runtime API

Research for #243 "Explore a unified ayme decorator and runtime API". Question: could `ayme` be one callable decorator that also exposes runtime operations as properties, keeping `ayme.action` as the member decorator, and how does that compare with keeping the decorator and the runtime entry points separate?

Source was read at `d0425aa` (`main`, after #252 and #302), plus the open Svelte (#305 to #311) and Angular (#307 to #316) stacks at their branch heads `claude/svelte-287` and `claude/angular-295`. Each claim is labelled:

- **source**: code or docs in this repository or ayme-private, at the cited path.
- **measured**: output of the probe in [`unified-ayme-api/probe`](unified-ayme-api/probe), reproducible with `run-probe.sh`.
- **inference**: my reasoning from the above. Not verified.

## Recommendation

Keep the decorator and the runtime separate. Do not add runtime properties to the imported `ayme`.

1. **The runtime already has a public name, and it is also `ayme`.** Every framework setup returns the runtime session as `ayme` (F5), and the docs teach `const { ayme, webMCP } = useAyme()` (F6). A combined import would give consumers two objects named `ayme` with runtime methods: one bound to the setup's lifecycle and one reaching whatever session is active in the document. They would differ in vocabulary, in when they work, and in which document they act on (§2).
2. **The thing a combined API would merge has no consumers.** The programmatic helper's operations are called only from its own test (F3). The session is the runtime API in practice, and every framework package already hands it out.
3. **Combining costs decorator-only modules their tree-shaking, permanently.** Properties on an exported function are reachable whenever the function is, so no bundler can drop them. Measured: a module that only marks a Page Object Model bundles to 465 bytes against a side-effect-free main entry and to about 690 KB against a combined `ayme` (F10). Today's main entry does not shake either, for an unrelated and fixable reason (F11).
4. **Typing and compiler detection are not obstacles.** A combined object type-checks in both decorator modes with bare and options forms, and misuse of a runtime property as a decorator is a type error (F8). The compiler's marker detection is unaffected by runtime calls on the same identifier (F12). These do not argue for the combined shape; they only remove two possible objections.

If a single import is still wanted for direct runtime use outside a framework, the evidence favours making the session that import's runtime, not the decorator (owner choice C1).

## Facts

1. `@ayme-dev/ayme` exports `ayme` from its root entry as `Object.assign(aymeClass, { action })`. `aymeClass` and `action` are overloaded for legacy (`target`, `key`, `descriptor`) and standard (`value`, `context`) calls, and for an options call that returns a decorator. The module has no imports ([decorators.ts](../../packages/ayme/src/decorators.ts)). Authority: source.
2. The programmatic helper `ayme: Ayme` has `getPageContext`, `getPageState`, `getPomDefinitions`, `click` and `fill`. It reads the global `document` and throws `RuntimeStateError("Ayme requires a browser Document.")` without one ([ayme.ts](../../packages/ayme/src/ayme.ts)). `click` and `fill` go through `requireAymeRuntimePage()`, which throws until a runtime owner has started ([refTools.ts:219-227](../../packages/ayme/src/refTools.ts), [registry.ts:107-113](../../packages/ayme/src/registry.ts)). It is exported only from `/internal` ([internal.ts](../../packages/ayme/src/internal.ts)), as #250 decided. Authority: source.
3. Outside `packages/ayme/src/ayme.test.ts`, no file in this repository calls a helper operation (`rg 'ayme\.(getPageContext|getPageState|getPomDefinitions|click|fill)\('` over `apps`, `packages`, `skills`, `docs`). Authority: source.
4. `createRuntimeSession(options)` returns `{ webMCP, page, goalLoop, pursueGoal, construct, register, start }`. `start()` makes it the document's single runtime owner and rejects a second one; `page` throws on the server; `construct` returns an inert Page Object on the server; `pursueGoal` throws unless started ([runtime.ts:100-293](../../packages/ayme/src/runtime.ts)). ADR-0030 keeps "one explicit runtime owner per document" with no implicit startup. Authority: source.
5. Each framework setup returns the session under the name `ayme`: Vue `UseAymeResult.ayme` ([vue/src/index.ts:60-76](../../packages/vue/src/index.ts)), React ([react/src/index.ts:89-108](../../packages/react/src/index.ts)), Svelte (`claude/svelte-287`, `packages/svelte/src/index.ts:17-58`) and Angular `AymeSetup.ayme` (`claude/angular-295`, `packages/angular/src/index.ts:31-35`). #250 user story 22 asks for this shape. Authority: source.
6. The Vue README shows `const { ayme, webMCP } = useAyme();` and says "`ayme` is the runtime session, so `ayme.pursueGoal(goal, { maxSteps })` runs a goal" ([vue/README.md:60-70](../../packages/vue/README.md)). The same README imports the Vite plugin as `import { ayme } from "@ayme-dev/unplugin-ayme/vite"` (line 21). Authority: source.
7. Page Object Model files are shared by the browser bundle and Playwright tests, and import the decorator from the main entry, e.g. [example-vue ListPage.ts](../../apps/example-vue/playwright/pom/ListPage.ts). Under Playwright they run in Node, unbundled, so importing `ayme` evaluates the whole main entry, including the runtime chunk. The Node recorder in ayme-private does not use the session or `document`: it drives a Playwright `Page` and imports `@ayme-dev/core/structural-observation` directly (e.g. `apps/ayme-cli/src/recording/enrichTraceArchive.ts`). ADR-0029 names a future `@ayme-dev/cli` for it. Authority: source.
8. A combined type, `typeof decorator & Ayme`, type-checks for `@ayme`, `@ayme({ description })`, `@ayme.action`, `@ayme.action({ description })` and `@ayme.action()` in both standard and `experimentalDecorators` mode, alongside `await ayme.getPageState()` and `ayme.click(ref)`. Using `@ayme.getPageState` on a class or `@ayme.click` on a method is a type error in both modes ([typing probe](unified-ayme-api/probe/typing/consumer.ts)). Authority: measured.
9. `Object.assign` onto a function throws `TypeError` for `name` and `length` (read-only own properties) and silently overwrites `prototype`, `call`, `apply` and `bind` on that function. Authority: measured (`run-probe.sh`, Node 24 in Devbox).
10. Bundling a module that only marks a class with `@ayme` and `@ayme.action` (minified, browser, ESM):

    | Imports `ayme` from                                         | esbuild 0.28 | rolldown 1.2 | Keeps the helper |
    | ----------------------------------------------------------- | ------------ | ------------ | ---------------- |
    | `decorators.ts` alone                                       | 465 B        | 458 B        | no               |
    | today's main entry                                          | 690,564 B    | 685,767 B    | no               |
    | a combined `ayme`                                           | 692,622 B    | 687,826 B    | yes              |
    | today's main entry, package declares `"sideEffects": false` | 465 B        | not run      | no               |
    | a combined `ayme`, package declares `"sideEffects": false`  | 692,622 B    | not run      | yes              |

    Authority: measured ([shake probe](unified-ayme-api/probe/shake)).

11. `packages/ayme/package.json` declares no `sideEffects` field; only `design-system` does. The built `index.mjs` imports the runtime chunk for `createPage` and `createRuntimeSession`, so a bundler keeps that chunk's top-level code for any root import. Authority: source; measured (F10).
12. The compiler treats a class as a Page Object Model when a decorator's expression is the identifier `ayme`, or `ayme.action` for members, after stripping a call ([derivePomManifests.ts:497-519](../../packages/unplugin-ayme/src/derivePomManifests.ts)). It does not resolve the symbol. A module enters the transform only if its text matches `/@(?:ayme|WebMCP)\b(?!-)/` ([pomProgram.ts:67-69](../../packages/unplugin-ayme/src/pomProgram.ts)). Probe results: `import { ayme as pom }` with `@pom` yields no Page Object Model and no error; `import * as Ayme` with `@Ayme.ayme` yields none and no error; a local `const ayme` that is not the import is still treated as the marker; a combined `ayme` whose action body calls `ayme.getPageState()` derives `CombinedPom.open` as expected. Authority: source; measured ([compiler probe](unified-ayme-api/probe/compiler)).
13. Generated code registers a compiled model with `import { registerCompiledPom } from '@ayme-dev/ayme/internal'` ([transformPomModule.ts:43](../../packages/unplugin-ayme/src/transformPomModule.ts)). It does not reference the decorator. ADR-0025 records as direction, not decision, that `registerCompiledPom` becomes a public runtime function and `/internal` disappears. Authority: source.

## 1. Typing

Inspection plus the probe settle it: adding properties to the decorator function does not change its call signatures, so every bare and options form keeps its current typing in both decorator modes (F8). The existing `decorators.test.ts` cases would hold unchanged.

Two real constraints remain. A runtime property cannot be named `name` or `length`, and naming one `call`, `apply`, `bind` or `prototype` would shadow `Function.prototype` behaviour (F9). And `action` is permanently taken by the member decorator, so a runtime operation can never use it, even though "action" is the natural word for one (Browser Tools are actions in #250).

## 2. Which session and document a runtime property acts on

The decorator is bound at import time; a runtime operation needs a document, a started owner and, in Node, a Playwright `Page`. The combined object has to pick one of these models:

| Model                                                                   | Browser                                                                                    | SSR                                    | Node (Playwright tests, recorder)               |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------- | ----------------------------------------------- |
| A. Global `document` and the active owner (what the helper does, F2)    | Works after a framework setup has started; reads fail before `start`, `click`/`fill` throw | Throws `RuntimeStateError`             | Throws; no `document`                           |
| B. Explicit session or page argument, e.g. `ayme.getPageState(session)` | Works, but the caller already holds the session, which has its own name (F5)               | Same as the session's server behaviour | Possible only with a different engine path (F7) |
| C. No runtime properties; the session is the runtime (today)            | `const { ayme } = useAyme()`                                                               | Session's inert server behaviour (F4)  | Not addressed by this API                       |

Model A duplicates the session with weaker guarantees: it works only while some owner is started, acts on whichever owner that is, and adds no lifecycle of its own. It also re-creates the confusion in §3. Model B adds an argument to every call to reach something the caller can already call directly. A browser global is not a common engine API for Node: the recorder never goes through the session or `document` (F7), so no model makes the combined object a cross-environment entry point without a separate Node design.

Activation is the same in every model: the helper's reads, the decorator and the import itself start nothing. Publication starts only in `session.start()` (F4). Importing does evaluate the runtime chunk in Node today, combined or not (F7).

## 3. Names

A consumer already meets three exports named `ayme`: the decorator (`@ayme-dev/ayme`), the Vite plugin (`@ayme-dev/unplugin-ayme/vite`) and the session returned by setup (F5, F6). Only the last one has runtime operations. With the combined API:

```ts
// Page Object Model file
import { ayme } from "@ayme-dev/ayme";

@ayme
export class ListPage {
  @ayme.action
  async archive() {
    await ayme.getPageState(); // model A: the active owner's document
  }
}

// Component
import { useAyme } from "@ayme-dev/vue";
const { ayme } = useAyme(); // the session: pursueGoal, webMCP, page
await ayme.pursueGoal("Archive the first item", { maxSteps: 5 });
```

Both read `ayme.<operation>`, but one has `getPageState` and `click(ref)` and the other has `pursueGoal` and `page.click(selector)`. In a module that imports the decorator and also calls `useAyme`, the destructured name collides with the import at module scope or shadows it inside a function. The compiler would still read a shadowing local `ayme` as the marker (F12). The separate alternative keeps one rule: the import marks, the setup result runs.

The helper's `click(ref)` and `fill(ref, value)` also collide in meaning with the Browser Tools `click` and `fill` that the open PR #303 adds, which take Playwright MCP inputs (`target`, `text`). A combined object would have to resolve that before shipping either name.

## 4. Import aliases and the compiler

Marker detection is by identifier text (F12). An aliased (`import { ayme as pom }`) or namespaced (`import * as Ayme`) decorator silently produces no Page Object Tools today. This is independent of the combined API, which neither fixes nor worsens it; it is the failure mode #250 user story 14 guards against for the old names, so it may deserve its own ticket. A combined API would make aliasing more tempting, because consumers who also destructure `ayme` from setup would rename one of the two.

Calling a runtime property inside a Page Object Model does not confuse detection (F12). Generated registration does not touch the decorator (F13), so the combined API changes nothing there today. If `registerCompiledPom` becomes public as ADR-0025 suggests, it would need a public home; that is the one place where a runtime property on the imported `ayme` has some pull, and it is an owner choice (C3).

## 5. Bundle cost for decorator-only consumers

In the supported browser setup the runtime is in the bundle anyway: the root setup creates the session and the generated code imports `/internal` (F13). Shakeability matters where nothing else pulls the runtime in: a production build that strips Ayme while leaving decorators in shared Page Object Model files (deferred by ADR-0030), and any consumer that does not run the build integration.

There the two alternatives differ structurally. With separate exports, declaring the package side-effect free lets bundlers reduce a decorator-only module to the 465-byte marker module. With a combined `ayme`, about 690 KB stays whatever the package declares, because the runtime is reachable from the decorator's own properties (F10). Making the properties lazy (dynamic `import()` per call) would recover most of it but forces every operation to be async and always emits a separate chunk (inference, not probed).

Whether `"sideEffects": false` is safe for the main package was not evaluated. The runtime registers state at module level in places, so it needs its own check (inference).

## 6. Consumer examples

Separate (today, with the helper staying internal):

```ts
import { ayme, createRuntimeSession } from "@ayme-dev/ayme"; // ayme only marks

const session = createRuntimeSession({ goalLoop });
const stop = session.start();
await session.pursueGoal("Archive the first item", { maxSteps: 5 });
session.webMCP.publicationStatus.state;
stop();
```

Combined (model A):

```ts
import { ayme, createRuntimeSession } from "@ayme-dev/ayme"; // ayme marks and runs

const stop = createRuntimeSession({ goalLoop }).start(); // still needed: ADR-0030 forbids implicit startup
const state = await ayme.getPageState(); // acts on the active owner's document
await ayme.click(ref); // a Structural Ref read from state; throws before start()
stop();
```

The combined form does not remove the session; it adds a second route to part of it.

## Unresolved product choices for the owner

- **C1. Should there be a single runtime import outside framework setup at all?** If yes, the evidence favours the session (or a function returning it) under its own name, not properties on the decorator. Options: keep `createRuntimeSession` as is; rename the setup result away from `ayme` to free the name; or accept two `ayme`s.
- **C2. Which session model, if runtime properties are ever added:** A (active owner), B (explicit argument) or none. §2 lists the consequences.
- **C3. Where `registerCompiledPom` lands if `/internal` goes away** (ADR-0025 direction): a public runtime function, or a property of the imported `ayme`.
- **C4. Whether a Node-side `ayme` runtime object should exist,** given that the recorder works on a Playwright `Page` through core and never through the session (F7). That is a separate design for `@ayme-dev/cli`, not something the decorator can carry.

Out of scope here but surfaced by the probe: aliased and namespaced decorators silently register nothing (§4), and the main package declares no `sideEffects`, so its root entry does not shake (F11).

## Probe

[`unified-ayme-api/probe`](unified-ayme-api/probe) holds the three probes and `run-probe.sh`, which prints every measured result above. It needs `pnpm install` and a build of `@ayme-dev/ayme` and `@ayme-dev/unplugin-ayme`. Nothing in it is wired into the workspace or CI.
