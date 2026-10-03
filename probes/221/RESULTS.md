# #221 probe: minimum React and Vue consumer versions

Probe run 2026-10-03 on Ayme main `d0425aa1ce6fc9fec9b569cbeee204ad228a0446`
(prepared baseline was `95c7893`; 9 commits since touch `packages/{ayme,react,vue}`,
including #299 `useAyme` and #301 runtime publication setup). Lite pin unchanged:
`e95ea4b7cadd62ff4f6d74a5101506e7e855a899`. Node 24.21.0, pnpm 11.24.0 (Devbox).

The brief's paths predate the #251 rename: `webmcp-react` → `packages/react`,
`webmcp-vue` → `packages/vue`, npm scope `@ayme-dev`.

Drift worth knowing: `@ayme-dev/react` has declared `peerDependencies.react: ^19.0.0`
since it was created (`fa1bdc9`), so the brief's "React 18 initial candidate" is
already outside the declared range.

## What each probe does

`probe.mjs` builds one clean consumer from `fixtures/` and the packed tarballs
(`pack.sh`, the `packedConsumer.test.ts` staging + real `pnpm pack`). The consumer
installs only the tarballs and its declared dependencies with
`--strict-peer-dependencies`, and runs:

| Step              | Checks                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| install           | strict peer resolution of the packed adapter                                                                                                                                                                                                                                                                                                                             |
| typecheck         | consumer `src` + spec with `skipLibCheck: false`, TS 6.0.3, against the packed `.d.mts`                                                                                                                                                                                                                                                                                  |
| build / ssr-build | Vite 8.2.2 + packed `@ayme-dev/unplugin-ayme` (`inspector: false`), development mode                                                                                                                                                                                                                                                                                     |
| ssr               | DOM-free Node render with the candidate's own server renderer. The POM constructor and action throw without `window`, so a render proves neither ran                                                                                                                                                                                                                     |
| browser           | Playwright 1.62.1, recording driver from `@ayme-dev/ayme/testing`. CSR page and hydrated SSR page: publication `active`, POM tool registered, tool executed, direct POM call, unmount removes the tool, remount re-registers a fresh instance and acts. Hydrated page must adopt the server DOM node (identity check); no console errors, no hydration/mismatch messages |

Negative controls: corrupting one server-rendered string makes the hydration test
fail. On React 18.0.0 the client re-renders the root and the node identity check
fails. On Vue 3.2.0 and 3.5.42 the console-error check fails with
"Hydration completed but contains mismatches."

No Lite or runtime mocks. Production adapter code is unmodified except in the
rows marked "patched", which use `proposed-patch.diff`.

Not covered: the consumer's `vite.config.ts` is excluded from the typecheck.
Including it fails on `unplugin`'s own declarations (`@farmfe/core`, `webpack`,
`rollup`, … not found) under `skipLibCheck: false`. That is an
`@ayme-dev/unplugin-ayme` tooling finding for #222, not a framework one.

## React

| Candidate                | Adapter                             | Pairing                                   | install  | types    | SSR      | browser + hydration | Classification                                                                            |
| ------------------------ | ----------------------------------- | ----------------------------------------- | -------- | -------- | -------- | ------------------- | ----------------------------------------------------------------------------------------- |
| 19.2.8                   | current                             | `@types/react` 19.2.18, `-dom` 19.2.7     | pass     | pass     | pass     | pass                | locked current                                                                            |
| 18.0.0                   | current                             | `@types/react` 18.0.0 / `-dom` 18.0.0     | **FAIL** | –        | –        | –                   | declared peer `^19.0.0` only                                                              |
| 18.0.0                   | current, staged peer `^18 \|\| ^19` | `@types/react` 18.0.0 / `-dom` 18.0.0     | pass     | **FAIL** | –        | –                   | types ecosystem: `@types/react@18.0.0` → `@types/scheduler@*` dropped `scheduler/tracing` |
| 18.0.0                   | current, staged peer                | same + override `@types/scheduler` 0.16.2 | pass     | pass     | pass     | pass                | —                                                                                         |
| 18.0.0                   | current, staged peer                | `@types/react` 18.3.31 / `-dom` 18.3.7    | pass     | pass     | pass     | pass                | —                                                                                         |
| 17.0.2                   | current, peer rule allows 17        | `@types/react` 17.0.0                     | pass     | pass     | **FAIL** | –                   | production runtime: `useSyncExternalStore` not exported by React 17 (boundary)            |
| 19.2.8 / 18.0.0 / 17.0.0 | patched (shim)                      | as above, 17: `@types/react` 17.0.0       | pass     | pass     | pass     | pass                | —                                                                                         |
| 16.8.0                   | patched                             | `@types/react` 16.8.0                     | pass     | **FAIL** | –        | –                   | public declarations: `ReactElement` without type args needs `@types/react` ≥ 16.8.3       |
| 16.8.0                   | patched                             | `@types/react` 16.8.3 or 16.14.70         | pass     | pass     | **FAIL** | –                   | infrastructure: Node ESM cannot read React 16.8's CJS named exports (`createContext`)     |
| 16.8.0                   | patched, SSR bundled by Vite        | `@types/react` 16.8.3                     | pass     | pass     | pass     | pass                | —                                                                                         |
| 16.14.0                  | patched, SSR bundled                | `@types/react` 16.14.70, `-dom` 16.9.25   | pass     | pass     | pass     | pass                | (unbundled: `react` OK, `react-dom/server` named export missing, consumer side)           |
| 16.7.0                   | patched, peer rule allows           | `@types/react` 16.14.70                   | pass     | pass     | **FAIL** | –                   | production runtime: no Hooks (`useContext is not a function`), boundary                   |

Adapter APIs used: `createContext`, `createElement`, `useContext`, `useEffect`,
`useState` (16.8+), and `useSyncExternalStore` (18.0+).

- **(a) Current production code: React 18.0.0** is technically compatible
  (types, browser lifecycle, SSR, hydration). The only blocker is the declared
  `^19.0.0` peer. Below 18, the `useSyncExternalStore` import fails.
- **(b) Small patch: React 16.8.0.** Import `useSyncExternalStore` from
  `use-sync-external-store/shim` (1.7.0, peer `^16.8.0 || … || ^19.0.0`; React
  18+ gets the native hook). Cost: one runtime dependency (official React
  package) plus `@types/use-sync-external-store` as a dev dependency. Existing
  13 adapter unit tests still pass on React 19. Below 16.8, Hooks do not exist.
- Development-side React lane (Ayme's own package at React 18.0.0, unpatched,
  `@types/react` 18.3.31): typecheck passes. 12 of 13 unit tests fail with
  `act is not a function`, because stable `act` from `react` arrived in 18.3.
  Importing `act` from `react-dom/test-utils` (`react-18.0-act-mechanics.diff`,
  test-only, no assertion changed) makes the suite pass. That's test mechanics,
  not a reason to raise the floor.
- Consumer restrictions at 16.x: `@types/react` ≥ 16.8.3, and SSR must bundle
  React (Next/webpack-style). Plain Node ESM can't import React 16's named
  exports. That applies to any ESM code, not just Ayme.

## Vue

| Candidate                                   | Adapter                     | install | types    | SSR  | browser + hydration | Classification                                                                                                                                                     |
| ------------------------------------------- | --------------------------- | ------- | -------- | ---- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 3.5.42                                      | current                     | pass    | pass     | pass | pass                | locked current                                                                                                                                                     |
| 3.5.2                                       | current                     | pass    | pass     | pass | pass                | oldest passing with shipped declarations                                                                                                                           |
| 3.5.1, 3.5.0, 3.4.0, 3.3.0, 3.2.47, 3.2.0   | current                     | pass    | **FAIL** | –    | –                   | public declarations: emitted `DefineComponent<…20 args>`; Vue 3.5.0–3.5.1 accept 19, 3.3–3.4 accept 13, 3.2 accept 12                                              |
| 3.2.0                                       | current (typecheck not run) | pass    | n/a      | pass | pass                | runtime/SSR/hydration compatible                                                                                                                                   |
| 3.2.0                                       | current, TS 5.9.3           | pass    | **FAIL** | –    | –                   | same declaration error, plus Vue 3.2.0's own `runtime-core.d.ts` TS2344                                                                                            |
| 3.2.39, 3.2.47, 3.3.0, 3.4.0, 3.5.0, 3.5.42 | patched (annotation)        | pass    | pass     | pass | pass                | —                                                                                                                                                                  |
| 3.2.0 – 3.2.38                              | patched                     | pass    | **FAIL** | n/a  | n/a                 | consumer TS: Vue's own declarations fail under TS 5.9/6 with `skipLibCheck: false` (`HostElement`/`RendererElement` TS2344; 3.2.20 also has a broken types export) |
| 3.1.5                                       | patched, peer rule allows   | pass    | n/a      | n/a  | build **FAIL**      | production runtime: `getCurrentScope` not exported (boundary)                                                                                                      |

Adapter APIs used: `getCurrentScope`/`onScopeDispose` (3.2+), plus long-standing
`defineComponent`, `inject`/`provide`, `shallowReactive`, `shallowReadonly`, `watch`.

- **(a) Current production code:** runtime, SSR and hydration work on **3.2.0**,
  but the shipped declarations only type-check on **Vue ≥ 3.5.2**. The `^3.2.0`
  claim is not honest for TypeScript consumers today. The existing CI lane
  (typecheck + unit at Vue 3.2.0) builds _from source_ with Vue 3.2 types, so it
  can't see this.
- **(b) Small patch:** annotate `AymeProvider: DefineComponent<UseAymeOptions>`
  (type-only, emitted JS byte-identical). Declarations then pass on every tested
  release from 3.2.39 to 3.5.42. 3.2.0–3.2.38 still fail only on Vue's own
  `.d.ts` under modern TS with `skipLibCheck: false` (a consumer TS restriction,
  not Ayme's). Their runtime is fine.
- The annotation keeps the props contract. With and without it, `h(AymeProvider, …)`
  rejects a wrong `webMCP` or `pageFactory` type and accepts valid options, on
  3.2.39, 3.3.0 and 3.5.42. Unknown props are accepted both before and after,
  through Vue's attribute fallthrough.
- Old-Vue development rebuild (separate constraint): with Vue 3.2.0 dev deps,
  Ayme's Vue package typechecks, passes 17/17 unit tests and emits declarations,
  with and without the patch. The historical TS4058 no longer reproduces.

## Upstream maintenance (evidence, not exclusion)

Last stable publish per line, from the npm registry `time` field on 2026-10-03:
React 16.14.0 (2020-10-14), 17.0.2 (2021-03-22), 18.3.1 (2024-04-26), 19.3.0
(2026-09-09). Vue 3.2.47 (2023-02-02), 3.3.13 (2023-12-19), 3.4.38 (2024-08-15),
3.5.43 (2026-09-17). React publishes no LTS policy ([versions](https://react.dev/versions)).
Vue has no fixed cycle and only the current minor gets patches. It also states
"We may ship incompatible changes to TypeScript definitions between minor
versions" ([releases](https://vuejs.org/about/releases#typescript-definitions)).
That is the mechanism behind the declaration failure above. So every floor
except React 19 / Vue 3.5 is unmaintained upstream. Whether to promise support
anyway is a product decision for #223.

## Proposed permanent checks (for #223, not implemented)

1. Extend `packedConsumer.test.ts` (or the minimum lane) with a consumer typecheck
   of the packed adapter at the floor with `skipLibCheck: false`. This is the
   check that would have caught the Vue declaration drift.
2. One browser + SSR/hydration smoke at each floor, reusing these fixtures or
   `apps/example-react` / a Vue equivalent, on packed tarballs.
3. Keep the floor lanes in the single matrix job #321 proposes; no Cartesian product.

## Reproduce

```bash
# inside Devbox, from this worktree
export PROBE_SCRATCH=/path/to/scratch
bash probes/221/pack.sh "$PROBE_SCRATCH/pack-main"                       # current code
bash probes/221/pack.sh "$PROBE_SCRATCH/pack-peer18" '^18.0.0 || ^19.0.0' # staged peer only
# apply proposed-patch.diff, pnpm install, then:
bash probes/221/pack.sh "$PROBE_SCRATCH/pack-patched" '^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0'
bash probes/221/run.sh <candidate.json>...                               # see candidates/
bash probes/221/vue-dev-rebuild.sh 3.2.0
```

`results.tsv` rows are chronological. Where a label repeats, the earlier row is
from before a fixture fix (typecheck scope, SSR bundling switch), and
`logs/<label>/` holds only the last run.

`pack-shim` in some candidates is the same as `pack-patched` minus the Vue
annotation. `results.tsv` is the append-only run log. Per-step logs, console
captures and `installed.json` (exact resolved versions) are in `logs/<label>/`.
