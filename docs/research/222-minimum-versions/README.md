# Minimum Next, Nuxt and tooling versions (#222)

Evidence for [#222](https://github.com/ayme-labs/ayme/issues/222), part of the [#220](https://github.com/ayme-labs/ayme/issues/220) map. Facts for [#223](https://github.com/ayme-labs/ayme/issues/223); no floor is approved here.

Probe date: 2026-10-03. Probes ran on Ayme main `d0425aa1` (drift from the ticket's `95c78935`: #299, #301, #302 and the #251 package rename; paths mapped to `packages/unplugin-ayme`, `@ayme-dev/*`). Lite pin unchanged (`e95ea4b7`). Devbox Node 24.21.0, pnpm 11.24.0, workspace TypeScript 6.0.3, React 19.2.8 / Vue 3.5.42 (locked-current) for every probe.

Each probe ran, in the fixture directory: `pnpm run build`, `pnpm run typecheck`, `pnpm run test:e2e:dev`, `pnpm run test:e2e:prod` (script: [`scripts/probe.sh`](scripts/probe.sh); per-probe output under [`logs/`](logs/), long logs trimmed to the first and last 80 lines, local paths replaced by `<worktree>`). Next dev E2E = 3 tests (SSR/hydration/publication/POM actions/remount + `incremental.spec.ts` dependency invalidation); prod = 2. Nuxt dev and prod = 2 each.

Only install-infrastructure change for every Next < 16.3 probe: `allowBuilds.sharp: false` in `pnpm-workspace.yaml` (pnpm otherwise refuses to install because `sharp`'s build script is unreviewed). Image optimisation is not exercised ([`diffs/sharp-allowbuilds.diff`](diffs/sharp-allowbuilds.diff)).

Re-check on main `38fdf26` (2026-10-04, after #331 made the Vite plugin set the Oxc legacy-decorator option itself and removed it from the Nuxt fixture): Next 16.0.0, Nuxt 4.0.1 and Nuxt 4.5.2 pass all four checks ([`logs/main-38fdf26-*`](logs/)).

## Next.js (experimental Turbopack loader path)

| Candidate               | Config                 | Build       | Typecheck | Dev E2E | Prod E2E                              |
| ----------------------- | ---------------------- | ----------- | --------- | ------- | ------------------------------------- |
| 16.3.4 (baseline)       | unchanged              | ✓           | ✓         | ✓ 3/3   | ✓ 2/2                                 |
| 16.3.8 (latest patched) | unchanged              | ✓           | ✓         | ✓ 3/3   | ✓ 2/2                                 |
| 16.0.0                  | unchanged              | ✓           | ✓         | ✓ 3/3   | ✓ 2/2                                 |
| 15.5.27                 | unchanged              | ✓ (webpack) | ✓         | ✗       | ✗                                     |
| 15.5.27                 | `--turbopack` flags    | ✓           | ✓         | ✓       | ✓ (but see note)                      |
| 15.5.27                 | flags + 15.x rule form | ✓           | ✓         | ✓ 3/3   | ✓ 2/2                                 |
| 15.5.0                  | flags + 15.x rule form | ✓           | ✓         | ✓ 3/3   | ✓ 2/2                                 |
| 15.4.11                 | flags + 15.x rule form | ✓           | ✓         | ✗ 1/3   | ✓ 2/2                                 |
| 15.3.0                  | flags + 15.x rule form | ✓           | ✓         | ✗ 1/3   | ✓ 2/2 (`turbopack.root` unrecognised) |

- Next 15.x defaults to webpack for `dev` and `build`; without `--turbopack` the loader never runs. Fixture adjustment: `next dev --turbopack`, `next build --turbopack` ([`diffs/next15-turbopack-flags.diff`](diffs/next15-turbopack-flags.diff)).
- `turbopack.rules.*.condition` is 16.0.0+ ([version history](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack#version-history)). On 15.5 the zod schema strips it silently: a loader trace showed each POM compiled twice (server + browser graph) instead of once. The 15.x nested form `"*.ts": { browser: { foreign: false, loaders, as } }` (the form Next 15 itself uses for its React Compiler rule) restores browser-only, non-foreign compilation (trace: once per POM). Reproducing the `content: /@ayme|extends/` filter via 15.x's top-level `turbopack.conditions` (`path`/`content`) was not explored; it is a performance filter (the loader returns transpiled JS for non-POM `.ts` either way). Diff: [`diffs/next15-config.diff`](diffs/next15-config.diff).
- 15.3.0 / 15.4.11 dev failure: client runtime error `Cannot read properties of undefined (reading 'data')` in Turbopack's `registerExportsAndSetupBoundaryForReactRefresh` while instantiating `packages/ayme/dist/runtime-*.mjs` (workspace-linked, so not "foreign"). Production passes. Inferred: a Turbopack dev HMR runtime defect fixed by 15.5.0; not attributable to an Ayme API. Unverified whether a packaged (node_modules) consumer would hit it.
- 15.5 Turbopack builds are beta ("Support for Turbopack builds is experimental" warning on 15.4).

Technical floor for the current fixture behaviour: **Next 16.0.0 unchanged; Next 15.5.0 with two explicit config adjustments**. First lower candidate failing: 15.4.11 (dev). Below 15.3.0 there is no top-level `turbopack` key and no `next build --turbopack`, so a production Turbopack build is unavailable (webpack fallback is out of scope).

## Nuxt (documented Vite path)

| Candidate                                | Vite          | Config                              | Build | Typecheck      | Dev E2E | Prod E2E |
| ---------------------------------------- | ------------- | ----------------------------------- | ----- | -------------- | ------- | -------- |
| 4.5.2 (baseline)                         | 8.2.2         | unchanged                           | ✓     | ✓              | ✓       | ✓        |
| 4.5.1, 4.5.0                             | 8.2.2         | unchanged                           | ✓     | ✓              | ✓       | ✓        |
| 4.5.2                                    | 8.2.2         | `vite.oxc.decorator.legacy` removed | ✓     | ✓              | ✗       | ✗        |
| 4.4.8, 4.2.2, 4.1.3, 4.1.0, 4.0.3, 4.0.1 | 7.3.6         | unchanged                           | ✓     | ✓              | ✓       | ✓        |
| 4.0.0 (×2)                               | 7.3.6         | unchanged                           | ✓     | ✓              | ✓       | ✗ 1/2    |
| 3.21.11                                  | 7.3.6         | unchanged                           | ✓     | ✗              | ✗       | ✗        |
| 3.21.11, 3.17.7                          | 7.3.6 / 6.4.3 | Nuxt 3 layout                       | ✓     | ✓              | ✓       | ✓        |
| 3.16.2                                   | 6.4.3         | Nuxt 3 layout                       | ✓     | ✗ fixture-only | ✓       | ✓        |
| 3.15.0                                   | 6.4.3         | Nuxt 3 layout                       | ✓     | ✗              | ✗       | ✓        |
| 3.14.0                                   | 5.4.21        | Nuxt 3 layout                       | ✓     | ✗              | ✗       | ✓        |
| 3.13.2                                   | 5.x           | Nuxt 3 layout                       | ✗     | ✗              | ✗       | ✗        |

- `vite.oxc.decorator.legacy` is required on Vite 8 (Nuxt 4.5): without it, dev and prod fail (`SyntaxError: Invalid or unexpected token` when the SSR runner loads the POM imported by `Counter.vue`, i.e. decorator syntax left untransformed; [`diffs/nuxt-no-oxc.diff`](diffs/nuxt-no-oxc.diff)). POMs sit outside the tsconfig Oxc reads. This was a consumer requirement at `d0425aa1`; since #331 the plugin sets the option itself on Vite 8, so on current main it no longer reaches consumers. On Vite 7 (Nuxt ≤ 4.4, esbuild) the option is ignored and all four checks pass unchanged.
- 4.0.0 prod: static assets 404 (`ENOENT .output/server/chunks/public/_nuxt/...`), publication stays `waiting`. 4.0.0 pins `nitropack` 2.12.0; 4.0.1 "Unpin `nitropack`" ([release](https://github.com/nuxt/nuxt/releases/tag/v4.0.1)). Inferred Nitro/packaging defect, not Ayme.
- Nuxt 3 layout = `future: { compatibilityVersion: 4 }` + `tsconfig.json` extending `.nuxt/tsconfig.json` ([`diffs/nuxt3-config.diff`](diffs/nuxt3-config.diff)).
- 3.16.2 typecheck errors are in the fixture's Nitro `rollupConfig` plugin (TS2589/TS7006), not Ayme.
- 3.15.0 / 3.14.0: `ayme()` plugin type not assignable to that Nuxt's `PluginOption`; dev SSR 500 "Invalid or unexpected token". Not root-caused.
- 3.13.2: config load fails, `import.meta` in unplugin 3's ESM dist under Nuxt 3.13's jiti 1 (CJS). Real consumer constraint: Ayme's Vite entry is ESM-only and needs an ESM-capable config loader (jiti 2: Nuxt ≥ 3.14).

Technical floor: **Nuxt 4.0.1 unchanged** (first lower candidate failing: 4.0.0 prod). Nuxt 3: 3.17.7 passes all four with the Nuxt 3 layout config; 3.16.2 passes behaviour; 3.15.0 fails. Nuxt 3 is EOL (2026-07-31), so this is reported, not recommended.

## Support and security (checked 2026-10-03)

- Next: 16.x Active LTS, 15.x Maintenance LTS ([support policy](https://nextjs.org/support-policy)). Latest patched: 16.3.8, 15.5.27 (2026-09-30 advisories, e.g. [GHSA-4jqv-mc3x-m676](https://github.com/vercel/next.js/security/advisories/GHSA-4jqv-mc3x-m676), list 16.3.x/15.5.x fixes; mapping to 16.3.8 / 15.5.27 inferred from same-day releases). Critical RCE [GHSA-2xp9-vwfh-vxw4](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4) fixed 16.3.3 / 15.5.24. Every 16.0.x and 15.5.0–15.5.26 release is affected by at least one published advisory.
- Nuxt: 4.x stable/patched, 3.x unsupported since 2026-07-31 ([roadmap](https://nuxt.com/docs/4.x/community/roadmap)). Oldest patched: 4.5.1 ([GHSA-9473-5f9j-94wq](https://github.com/nuxt/nuxt/security/advisories/GHSA-9473-5f9j-94wq), [GHSA-48hr-524c-v5w3](https://github.com/nuxt/nuxt/security/advisories/GHSA-48hr-524c-v5w3)); 3.x last patched 3.21.10.

| Path | Technical floor                  | Oldest passing patched                                        | Unsupported lines that pass |
| ---- | -------------------------------- | ------------------------------------------------------------- | --------------------------- |
| Next | 16.0.0 (15.5.0 with adjustments) | 16.3.8 (passes unchanged) / 15.5.27 (passes with adjustments) | none                        |
| Nuxt | 4.0.1                            | 4.5.1                                                         | 3.17.7–3.21.11 (adjusted)   |

## Tooling constraints reaching consumers

- Node: `unplugin@3.3.0` engines `^20.19.0 || >=22.12.0`; Ayme's published packages declare no `engines`. Vite 7/8 `^20.19.0 || >=22.12.0`. Next 16 `>=20.9.0`; Next 15.5 `^18.18 || ^19.8 || >=20`. Nuxt 4.0–4.4 `^20.19.0 || >=22.12.0`; **Nuxt 4.5 `^22.19.0 || ^24.11.0 || >=26`**, above the 20.19 consumer floor. Node 20 itself is upstream EOL (2026-04-30; nixpkgs removed it). Node 20.19 was **not** verified: no Node 20 runtime is available locally without downloading one. Partial check on Node 22.12.0 (the other engines lower bound, run directly without pnpm): Next 16.3.4 `next build` + `tsc` pass; Nuxt 4.5.2 `nuxt build` passes despite its `^22.19` engines (engines are advisory). E2E were not run on 22.12 (pnpm 11 needs Node ≥ 22.13). Logs: [`logs/node-22.12.0/`](logs/node-22.12.0/).
- Vite: Nuxt Vite 7 and Vite 8 pass. `unplugin-ayme` declares no `vite` peer. Vite 6 passes via Nuxt 3.16/3.17; Vite 5 (Nuxt 3.14) not established.
- TypeScript (consumer compiler, separate from the unplugin's own `typescript ^6.0.3` dependency): consumer `tsc` on the Next app and POM configs passes with TS 5.9.3, 5.4.5, 5.0.4 (`skipLibCheck: true`, target ES2022; the repo's shared `target: ES2024` is rejected by 5.4.5 and 5.0.4; it needs TS ≥ 5.7 — fixture config, not Ayme). With `skipLibCheck: false`, 5.4.5 is clean; 5.0.4 fails only inside `@types/node` 24, `playwright-core` 1.62 and `zod` 4 types. 5.1–5.3 not bisected. Output: [`logs/ts-probe-standalone.txt`](logs/ts-probe-standalone.txt) (configs from [`scripts/mk-probe-tsconfig.cjs`](scripts/mk-probe-tsconfig.cjs), run by [`scripts/ts-probe.sh`](scripts/ts-probe.sh)). Nuxt config typecheck with older TS not tested.
- Config loading: Ayme's Vite entry is ESM-only (unplugin 3 uses `import.meta.dirname`); CJS config loaders fail (Nuxt 3.13 / jiti 1).

## Adoption snapshot (retrieved 2026-10-03T18:09:22Z)

Raw responses and aggregation: [`adoption/`](adoption/), `node scripts/aggregate.mjs adoption`.

Endpoints: `https://api.npmjs.org/versions/<pkg>/last-week` (no dates returned) and `https://api.npmjs.org/downloads/point/last-week/<pkg>` (2026-09-25..2026-10-01). Per-version sums exceed the point totals by 17–31%, so the windows do not match and are not combined. Shares are of stable per-version downloads.

| Package | Major / slice                       | Share                               |
| ------- | ----------------------------------- | ----------------------------------- |
| React   | 19 / 18 / 17 / 16 ≥16.8 / 16 <16.8  | 67.4% / 27.0% / 2.7% / 2.3% / 0.15% |
| Vue     | 3 / 2                               | 87.4% / 12.5%                       |
| Next    | 16 / 15 ≥15.5 / 15 <15.5 / 14 / ≤13 | 61.3% / 19.6% / 6.8% / 9.4% / 2.8%  |
| Nuxt    | 4 / 3 ≥3.17 / 3 <3.17 / 2           | 59.2% / 19.9% / 12.2% / 8.5%        |

Excluded non-stable: React 0.82M, Vue 65k, Next 0.65M, Nuxt 4.6k. Downloads are not users, apps or market share (CI reinstalls, transitive installs, caches).

State of React 2025 ([usage](https://2025.stateofreact.com/en-US/usage/)), question "Which version of React do you use the most on a daily basis?", 2,636 respondents to that question (page says 70% of question respondents): 19.x 48.4%, 18.x 41.3%, 17.x 3.8%, 16.x 2.4%, not sure 3.6%. Survey dates not shown on the page; respondents are self-selected and more engaged than average.

Prioritisation (separate from compatibility): Next 15 ≥15.5 (~20%) justifies keeping the cheap 15.5 adjustment documented; Nuxt 3 ≥3.17 (~20%) is sizeable but EOL.

## Effective dependency pairs

- Next path (experimental Turbopack loader): Next ≥ 16.0.0 unchanged, or Next 15.5.x with `--turbopack` flags and the 15.x rule form; React 19 (locked-current; #221 owns React minima); Node per unplugin 3 engines `^20.19 || >=22.12` (20.19 unverified, 22.12 build-only); consumer TS ≥ 5.0 with `skipLibCheck`, ≥ 5.4 clean.
- Nuxt path (documented Vite plugin): Nuxt ≥ 4.0.1 on Vite 7 unchanged; Nuxt 4.5+ on Vite 8 needs Oxc legacy decorators (set by the plugin since #331) and raises Node to `^22.19 || ^24.11 || >=26`; Vue 3.5.42 (locked-current; #221 owns Vue minima); ESM-capable config loader; same TS findings for POM configs.

## Proposed CI coverage (not implemented; #321 owns the matrix)

- Next: current (16.3.x) + minimum 16.0.x unchanged config. Optional: 15.5.x lane with the two adjustments if 15.5 is claimed.
- Nuxt: current (4.5.x, Vite 8) + minimum 4.0.1 (Vite 7).

## Reproduce

In a Devbox shell at the repository root, with dependencies built (`pnpm exec turbo run build --filter=@ayme-dev/example-next^... --filter=@ayme-dev/example-nuxt^...`):

1. Set the candidate in `apps/example-next/package.json` or `apps/example-nuxt/package.json`, apply the listed diff if any, then `pnpm install` (add `sharp: false` under `allowBuilds` for Next < 16.3).
2. Run `docs/research/222-minimum-versions/scripts/probe.sh next|nuxt <label>`; results go to `$PROBE_LOGS/<label>` (default `../probe-logs`).
3. Loader-graph trace (15.x rule form): temporarily append `process.getBuiltinModule("node:fs").appendFileSync(<file>, this.resourcePath + "\n")` at the top of `turbopackLoader` in `packages/unplugin-ayme/dist/turbopack-loader.mjs`, run `next build`, and count lines per POM.
