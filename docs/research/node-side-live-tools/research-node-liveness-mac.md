# Node-side live Page Object Tools

Research and pilot: how hard is it to run Ayme's live-tool logic (which Page Object Tools are live right now) in Node against a real Playwright `Page`, with one implementation shared with the browser runtime on Playwright Lite?

Read on 2026-10-06 at `origin/main` 528f1fb2 ("feat(inspector): dogfood the Inspector through its own Page Object Tools (#491)"). File references are `packages/ayme/src/<file>:<line>` unless said otherwise. Each claim is labelled **source** (read in the repo or in `node_modules`), **measured** (observed by running the pilot) or **inference** (my reasoning).

The pilot was written in `packages/ayme/scratch/node-live/` of a local worktree; it is published here under `probe/mac/`.

## Summary

1. The liveness policy is already portable. `probePomRootState` (`pomReachability.ts:10-500`) uses only `Locator.count()`, `Locator.isVisible()` and `Locator.evaluate(fn)` with a self-contained callback, as ADR-0019/0020 required. The pilot ran that function unchanged on a real Playwright `Locator` from Node and got the ADR-0020 matrix: absent root, present and available root, present but modal-blocked root (**measured**).
2. Everything that binds the registry to the browser is in `registry.ts` and sits at five points: locator recognition, synchronous element resolution and `Element` identity, the DOM observer, Structural Ref resolution for collection tools, and tool execution through `runAction(document, …)`. The activation rule, tool construction and naming, member reading, input validation and manifest handling are pure (**source**).
3. The seam that serves both runtimes is a page-driver port with three operations (`isLocator`, `observeRoot`, `watch`) in front of one deep module that owns registrations, probing and the live set. The pilot's extraction of that module is 330 lines, and the real-Playwright adapter is 60 lines (**measured**).
4. The hard parts are not liveness. They are (a) the registry's module-level singleton state, (b) tool execution without a `document` (Settled Page, Change Record, interaction history), and (c) a Structural Ref space in Node for collection tools. Each is a scoping decision, listed under open questions.
5. One trap: loading the production source through an esbuild-based TypeScript loader with `keepNames` (tsx, vitest) injects a `__name` helper into the in-page callback; Playwright serializes the callback by source, the page has no `__name`, and `probePomRootState` swallows the error and reports the root absent. Node's native type stripping and the built `dist` do not have this (**measured**).

## 1. Where core computes registration, liveness, children and collections

### Runtime owner and page

- One runtime owner at a time, module-level: `browserPage`, `runtimeOwner` (`registry.ts:85-86`), `createAymeRuntime(page?)` (`registry.ts:121-143`) defaults the page to Playwright Lite's `createPage()` (`browserPage.ts:29-47`). `createAyme` (`runtime.ts:207-434`) builds the page lazily through `instrumentedPage` (`runtime.ts:209-210`), which recognises locators with `isPlaywrightLiteLocator` (`pageInstrumentation.ts:1`, used at `:73`).
- `start()` (`runtime.ts:395-431`) creates the owner, opens the document's interaction history (`runtime.ts:402`, `document`), registers every counted POM and subscribes `refreshTools` to the registry (`runtime.ts:409-412`).

### Registration

- Compiled metadata arrives per class through `registerCompiledPom` (`registry.ts:152-154`), called by the code `unplugin-ayme` emits (`packages/unplugin-ayme/src/transformPomModule.ts:38-43`). The compiler itself runs in Node from a TypeScript program (`packages/unplugin-ayme/src/derivePomManifests.ts:35-42`); the pilot used it directly.
- `registerPageObject` (`registry.ts:186-228`) rejects a second class with the same name (`:195-204`), builds the tools once from the manifest (`:212`), starts the DOM observer on the first registration (`:216`) and notifies subscribers. `pom.register`/`unregister` in `runtime.ts:362-379` count registrations per class.

### Liveness and availability

- Probe lifecycle: `schedulePomMemberProbe`, `runPomMemberProbe`, `probeRegistrations` (`registry.ts:257-328`) coalesce probes, guard against a disposed runtime with `probeLifetime`, and notify only on a changed observation (`:306-327`). Pure.
- Per registration, `probePomMembers` (`registry.ts:804-831`) reads the declared `root` member (a locator member named `root`, `:812-814`) and then `probeMembers` (`:905-1005`) walks every member: a locator's `count()`, a component's `root` through `observeRoot`, and the component's own members recursively, with an ancestor set against cycles (`:913-914`).
- `observeRoot` (`registry.ts:833-855`): `count()`, Playwright Lite element resolution before and after the probe (`:839`, `:846`) so the observation belongs to one element, and `probePomRootState` for `{present, available}` (`:845`).
- `probePomRootState` (`pomReachability.ts:10-500`): `count() !== 1 || !isVisible()` is absent (`:14`); otherwise one `evaluate` callback (`:16-496`) computes Page Object Presence (geometry, scroll reachability, clipping) and Availability (`:modal` blocking `:346-356`, `inert` `:357-368`, obstruction sampling `:304-337`). Any error is absent (`:497-499`).
- The activation rule, `listCallerAwarePomTools` (`registry.ts:431-455`): a registered POM's own tools are live when it declares no root (`:434-436`, `:441`) or its root is available; a component tool is live when some available root's path matches the tool's component path (`:445-449`, `isLiveComponentRoot` `:501-511`). `isRootAvailable` (`:389-393`) requires `isRootPresent` (`:383-387`), which also requires `element.isConnected`. First tool name wins (`:450-451`).
- `publishedTools.ts:47-83` merges the live POM tools with Browser Tools, Custom Tools, `snapshot` and `goal`; `runtime.ts:237-244` republishes `tools.list()` from it on every registry notification; `webMcp.ts:261-264` mirrors it into WebMCP and re-probes after each call (`webMcp.ts:176-181`, `runtime.ts:341-345`).

### Children and collections

- Tools for children are built once at registration: `createRegisteredTools` (`registry.ts:528-548`) walks component members, `createComponentTools` (`:569-596`) recurses with a class-name cycle guard, and `createComponentTool` (`:598-649`) picks the shape: a singular child's tool runs on the instance reached through the member path (`createSingularComponentTool` `:651-683`, `resolveSingularComponent` `:725-735`); a tool through a collection is published once and takes `{ ref, args }` (`refComponentToolManifest` `:685-713`).
- A collection tool resolves `ref` through the page state (`resolveRefToElement` `:737-749` → `resolvePageStateRefs(document, ref)` `pageState.ts:226-231`) and finds the instance whose `root` resolves to that exact `Element` (`resolveComponentByElementStep` `:751-802`, identity check at `:788-789`).
- `listCollectionToolRoots` (`:462-486`) and `getRegisteredPomStructure` (`:359-381`) hand present roots, as `Element`s, to structural capture (`pageState.ts:484-...`), which labels them in the Structural Page State and omits non-present subtrees. `pomDefinitions.ts` renders compiled definitions from the registered manifests only (pure).

## 2. Browser-only versus portable

| Concern                                   | Where                                                                                                                 | Portable?                                                                                                                                                                                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reachability / availability policy        | `pomReachability.ts:10-500`                                                                                           | Yes, as is. Standard `Locator` interface; callback is self-contained and returns serializable state. Verified on real Playwright (**measured**).                                                                                                         |
| Activation rule, path matching            | `registry.ts:431-455, 494-515`                                                                                        | Yes. Needs only `{path, present, available}` per root.                                                                                                                                                                                                   |
| Tool construction, naming, member reading | `registry.ts:528-735, 1007-1017`                                                                                      | Yes.                                                                                                                                                                                                                                                     |
| Input validation                          | `registry.ts:1048-1137`                                                                                               | Yes.                                                                                                                                                                                                                                                     |
| Probe coalescing, lifetime, change-only   | `registry.ts:257-348`                                                                                                 | Yes.                                                                                                                                                                                                                                                     |
| Manifests, definitions                    | `contracts.ts`, `pomDefinitions.ts`, `unplugin-ayme/src/derivePomManifests.ts`                                        | Yes. The compiler already runs in Node.                                                                                                                                                                                                                  |
| Locator recognition                       | `registry.ts:1160-1162` → `isPlaywrightLiteLocator`; `internal.ts:50`; `pageInstrumentation.ts:1`                     | No. Lite brands its locators; Playwright's `Locator` is a plain class (duck-typed in the pilot).                                                                                                                                                         |
| Synchronous element resolution, identity  | `registry.ts:1164-1166` → `resolveLocatorElements`; `ObservedPomRoot.element` (`:72-77`); `observeRoot` `:839-847`    | No. Playwright resolves asynchronously and returns handles, not comparable `Element`s. Liveness does not need identity: a root swap with the same flags gives the same live set (`:306-317`, **inference**). Structural labels and collection refs do.   |
| DOM observer and layout events            | `registry.ts:96-103, 230-255`; `pageActivitySource.ts:22`                                                             | No. In Node: re-probe after each tool call (already the pattern, `webMcp.ts:176-181`), plus an in-page `MutationObserver` calling an exposed function (pilot).                                                                                           |
| Structural Ref resolution (collections)   | `registry.ts:737-802`; `pageState.ts:226-231, 484-...` (`captureAriaSnapshot` from Lite `internal`)                   | No. Lite's dual ARIA capture gives `refsByElement: Map<Element, string>`. Playwright exposes `locator.ariaSnapshot()` without refs; an `aria-ref` selector engine exists in `playwright-core` 1.62's `coreBundle.js` but is not public API (**source**). |
| Tool execution wrapper                    | `registry.ts:1019-1046` → `runAction(document, …)` (`actionSequence.ts:55-...`): Settled Page, Change Record, history | No. Document-bound: in-page activity source, `browserMonotonicClock`, capture through Lite.                                                                                                                                                              |
| WebMCP publication                        | `webMcp.ts`, `document.modelContext`                                                                                  | Not applicable in Node; the Node consumer is the e2e runner, not WebMCP.                                                                                                                                                                                 |

What the Playwright Lite fork provides that real Playwright lacks or does differently (**source**: `packages/ayme/node_modules/@ayme-dev/playwright-lite/dist/internal.d.mts`, ADR-0018/0021):

- `./internal`: `isPlaywrightLiteLocator` (brand check), `resolveLocatorElements` (synchronous `Element[]` for a locator in the current document), `captureAriaSnapshot(root)` (distilled and full ARIA text plus `refsByElement`). None has a public Playwright counterpart.
- It runs inside the document: synchronous DOM access, `Element` identity across calls, synthetic (untrusted) input, one document only. Real Playwright runs out of process over CDP: every read is a round trip, input is trusted, `evaluate` callbacks travel as source text.
- Shared surface: the public `Page`/`Locator` methods the compatibility ledger marks implemented, including `count`, `isVisible`, `evaluate`, `getByRole`, `click`, `fill`.

## 3. Proposed seam

Vocabulary from the `codebase-design` skill: module, interface, seam, adapter, depth.

**Module: live Page Object observation.** Interface: `register(manifest, instance) → dispose`, `probe()`, `list()` (live tools, in registration and declaration order), `subscribe(listener)`, plus the per-root observations for capture. Implementation: everything in `registry.ts` from `registerPageObject` through `probeRegistrations`, `probePomMembers`, `probeMembers`, `observeRoot` and `listCallerAwarePomTools`, and `probePomRootState`. This is where the depth already is; it stays one implementation.

**Port: `PageDriver`**, the only thing the module needs from a runtime:

```ts
type PageDriver = {
  isLocator(value: unknown): value is Locator;
  observeRoot(root: Locator): Promise<{ present: boolean; available: boolean }>;
  watch(onChange: () => void): () => void;
};
```

- `isLocator`: Lite adapter = `isPlaywrightLiteLocator`; Playwright adapter = duck-typing (`count`, `evaluate`, `locator`, `page` are functions) or `instanceof` from `playwright-core`.
- `observeRoot`: both adapters call `probePomRootState`. The Lite adapter additionally returns the `Element` (its two-sided identity check at `registry.ts:839-847`) for structural capture; that is an optional field of the observation, not a port method the Node adapter must satisfy.
- `watch`: Lite adapter = the `MutationObserver` and layout events now at `registry.ts:230-255`; Playwright adapter = an exposed function fed by an in-page `MutationObserver` (reinstalled on `load`), and the existing probe after each tool call.

Two adapters, so the seam is real. It is also the seam ADR-0025 anticipated: the registry read model becomes public "when a second adapter reads it, such as a driver on the Playwright side".

**Outside the module, adapter-specific**, because they vary in kind rather than in a few operations:

- Tool execution wrapping: the browser wraps every call in `runAction` (Settled Page, Change Record, interaction history). A Node tool can return the method's result (what the pilot does) or get its own settle policy; this is a product decision, not a port method.
- Structural capture and labels: browser only, until Node has a structural capture.
- Collection `ref` resolution: needs a ref space in Node first (open question).

**Not a seam**: `Element` identity, the WebMCP driver, the Inspector read model. Keep them in the browser adapter and in the publication layer.

**Where it lands in the package**: a Node entry (for example `@ayme-dev/ayme/playwright`) must not import `@ayme-dev/playwright-lite` or touch `document` at module load. Today `index.ts` → `runtime.ts` → `browserPage.ts` pulls Lite in, and `registry.ts` imports Lite's `internal` and `pageState` at the top. So the module needs to be a file (or files) that import only `contracts`, `errors`, `pomReachability` and the port type, with the two adapters in their own files.

## 4. Pilot

Files: `packages/ayme/scratch/node-live/` — `liveTools.ts` (the module and the Playwright adapter), `AppPage.ts` (a rootless `AppPage` with a rooted `CounterSection` child, PR #500's `readonly root: Locator`), `AppPage.decorated.ts` (the same with `@ayme` marks, for the compiler), `derive-manifest.ts`, `pilot.ts`, `fallback.html`.

How to run (from `packages/ayme`, inside Devbox):

```sh
node scratch/node-live/pilot.ts                              # against fallback.html
AYME_PILOT_URL=http://127.0.0.1:4491 node scratch/node-live/pilot.ts   # against apps/example-react
node ../../node_modules/.pnpm/tsx@4.23.13/node_modules/tsx/dist/cli.mjs scratch/node-live/derive-manifest.ts
```

What it checks, in order: (1) counter mounted → `AppPage.counter.increment` live; (2) running that live tool increments the output; (3) `AppPage.toggleCounter` (rootless, always live) unmounts the counter → child tool withdrawn, root `count: 0`; (4) mounting again → live; (5) an injected `<dialog>.showModal()` → root `present: true, available: false`, tool withdrawn, and `probePomRootState` called directly agrees; (6) closing it → live; (7) unmounting from the page with no explicit `probe()` → the subscription fires through the in-page `MutationObserver`.

### Run 1: fallback page (static copy of the example's DOM), Node 24.21 native type stripping, Playwright 1.62.1, Chromium 1234

All 15 checks passed (**measured**):

```
serialization: callback ran in page (BODY)
1. Counter mounted
ok   counter root: {"path":"counter","count":1,"present":true,"available":true}
ok   live tools: ["AppPage.toggleCounter","AppPage.counter.increment"]
2. Run the live tool AppPage.counter.increment
ok   output after increment: "1"
3. Unmount counter through the rootless tool AppPage.toggleCounter
ok   counter root: {"path":"counter","count":0,"present":false,"available":false}
ok   live tools: ["AppPage.toggleCounter"]
4. Mount counter again (through the app's button, not a tool)
ok   counter root: {"path":"counter","count":1,"present":true,"available":true}
ok   live tools: ["AppPage.toggleCounter","AppPage.counter.increment"]
5. Open a modal dialog over the page (ADR-0020: present, not available)
ok   counter root: {"path":"counter","count":1,"present":true,"available":false}
ok   live tools: ["AppPage.toggleCounter"]
ok   probePomRootState directly (unchanged production function): {"present":true,"available":false}
6. Close the modal
ok   live tools: ["AppPage.toggleCounter","AppPage.counter.increment"]
7. Wake-up source: unmount from the page, no explicit probe
ok   subscription fired without probe(): true
ok   live tools: ["AppPage.toggleCounter"]
```

Step 5 is the validity check: a swallowed in-page error would read `present: false`, so `present: true, available: false` shows the production callback really ran in Chromium.

`derive-manifest.ts` produced, through `unplugin-ayme`'s `derivePomManifests` in Node, the same manifests the pilot hand-writes (plus `authoredDescription`), with `CounterSection` as a component of `AppPage` and `root` as a locator member (**measured**).

### What broke

- First attempt through `tsx`: `locator.evaluate: ReferenceError: __name is not defined`, and every root read `present: false` (**measured**). tsx compiles with esbuild `keepNames: true` (**source**: `node_modules/.pnpm/tsx@4.23.13/node_modules/tsx/dist/index-*.mjs`); vitest does the same by default. Playwright Test transpiles with Babel (`node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/lib/transform/babelBundle.js`), so a `@playwright/test` consumer of the built package should not hit this; the built `dist/index.mjs` of the main checkout contains no `__name` (**source**). A Node test lane that imports the source through vitest would.
- Node's native type stripping rejects decorators and parameter properties, so the pilot POM has no `@ayme` marks and a decorated twin for the compiler.

### Run 2: apps/example-react on Vite at 127.0.0.1:4491

Pending the load gate (the brief's rule: start Vite only when the 1-minute load average is below ~8; it was 10 to 55 during this session). The result is appended below when it ran.

## 5. Effort estimate for doing it for real

Assumes the seam in section 3 and no change to the browser behaviour. Days are focused engineering days, **inference**.

| Variation point                                         | Work                                                                                                                                                                                                                                                                                   | Estimate  |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Registry as an instance behind the port                 | Turn the module-level state (`registry.ts:85-95`) into `createPomRegistry(driver)`; the browser keeps its singleton façade for `runtime.ts`, `webMcp.ts`, `pageState.ts` and the Inspector's read model (`internal.ts:22-37`). Element identity becomes an optional observation field. | 2–3 days  |
| Locator recognition and member probing                  | Replace `isLocator`/`locatorElements` with the port; Playwright adapter as in the pilot.                                                                                                                                                                                               | 0.5–1 day |
| Wake-up source                                          | Move `startObservingPage`/`stopObservingPage` into the Lite adapter's `watch`; Playwright adapter from the pilot (`exposeFunction` + `addInitScript`).                                                                                                                                 | 1 day     |
| Node tool execution, plain results                      | Call the method, validate input, no `runAction`. Register the resulting tools with the e2e runner.                                                                                                                                                                                     | 1 day     |
| Node tool execution with Settled Page and Change Record | Needs a Node activity source (exposed `MutationObserver` + network idle) and a structural capture in Node; `capturedTree.ts` parses Lite's text, Playwright's `ariaSnapshot()` has no refs. Separate decision.                                                                         | 1–2 weeks |
| Collection tools in Node                                | A ref space (Playwright's internal `aria-ref`, an index, or a Node-side capture) and `resolveComponentByElementStep` without `Element` identity (compare through `evaluate` on both handles).                                                                                          | 3–5 days  |
| Packaging and tests                                     | A Node entry free of Lite and `document`; a Node lane that launches Chromium (today only the e2e lane does); guard against the esbuild `keepNames` trap.                                                                                                                               | 2 days    |

Liveness for top-level and singular-child tools with plain results: about 1.5 to 2 weeks. With collections: add a week. With Settled Page and Change Record in Node: a separate project.

## 6. Open questions for Abel

1. The Node-side prototype ("publishes every top-level POM class statically and approximates liveness with `root.isVisible()`"): where is it? (Answered after the run: it is `docs/research/e2e-integration/prototype/no-fork/src/ayme-tools.ts`, `aymeAvailability`, which by then checked "present and not covered" rather than `isVisible()` alone. It lived outside the ayme repo, in a clone of tester-army/e2e.) It is not in the `ayme` worktrees on this Mac (searched the working trees, `git log --all -S"isVisible"`, the e2e-spike stash list) nor in the sibling repos. Its tool shape and runner integration decide the Node execution wrapper.
2. Node tool results: the method's return value (as in the pilot), or a Settled Page wait and a Change Record like the browser? The second needs a structural capture in Node.
3. Collection tools in Node: which ref space, or leave collections out of the first Node version?
4. Is refactoring `registry.ts` to an instance behind the port acceptable, with the browser keeping its singleton façade for the Inspector and publication?
5. Package entry: a new Node entry (for example `@ayme-dev/ayme/playwright`) or `/internal`? ADR-0025/0031 call `/internal` transitional.
6. Should the in-page callback be hardened against loader-injected helpers (ship it as a string, or document the constraint)?
