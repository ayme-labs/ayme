# Node 20.19 floor for the Next and Nuxt integrations (#345)

Evidence for [#345](https://github.com/ayme-labs/ayme/issues/345), part of the [#220](https://github.com/ayme-labs/ayme/issues/220) map, following up [#222](https://github.com/ayme-labs/ayme/issues/222#issuecomment-5977516803). Facts for [#223](https://github.com/ayme-labs/ayme/issues/223); no floor is approved here.

Probe date: 2026-10-04. Ayme main `7f0485a`, Lite pin `e95ea4b`. Node 20.19.0 official `darwin-arm64` build from nodejs.org (SHA-256 checked against `SHASUMS256.txt`), macOS arm64. TypeScript 6.0.3, React 19.2.8, Vue 3.5.42, Playwright 1.62.1.

## How Node 20 was applied

pnpm 11.24.0 needs Node ≥ 22.13, so pnpm itself runs on Devbox Node 24.21.0 through [`scripts/pnpm-shim.sh`](scripts/pnpm-shim.sh), placed before Node 20.19.0 on `PATH`. Everything pnpm starts resolves `node` from `PATH`. [`scripts/record-node.cjs`](scripts/record-node.cjs), preloaded through `NODE_OPTIONS`, records the version and entry script of every Node process in each probe's `node-trace.txt`. Only the `pnpm.mjs` processes run on 24.21.0. `next build/dev/start`, its workers and Turbopack loader pools, `nuxt`, the Nitro production server, `tsc`, `vue-tsc` and Playwright all run on v20.19.0.

Each probe runs the fixture's build, typecheck, development E2E and production E2E ([`scripts/probe.sh`](scripts/probe.sh), the #222 script). Next < 16.3 also needs `allowBuilds.sharp: false` to install, as in #222.

## Results on Node 20.19.0

| Candidate                     | Build | Typecheck | Dev E2E | Prod E2E     |
| ----------------------------- | ----- | --------- | ------- | ------------ |
| Next 16.3.4 (current fixture) | ✓     | ✓         | ✓ 3/3   | ✓ 2/2        |
| Next 16.0.0                   | ✓     | ✓         | ✓ 3/3   | ✓ 2/2        |
| Nuxt 4.0.1                    | ✓     | ✓         | ✓ 2/2   | ✓ 2/2        |
| Nuxt 4.4.5                    | ✓     | ✓         | ✓ 2/2   | ✓ 2/2        |
| Nuxt 4.4.8                    | ✗     | ✓         | ✓ 2/2   | ✗ (no build) |
| Nuxt 4.5.2 (current fixture)  | ✗     | ✓         | ✓ 2/2   | ✗ (no build) |

Nuxt 4.4.8 and 4.5.2 fail `nuxt build` with `TypeError: trustedFunctions.difference is not a function` in `postcss-merge-longhand` 8.0.4. That package belongs to cssnano 8, which declares Node `^22.11.0 || ^24.11.0 || >=26.0` and uses `Set.prototype.difference`, available from Node 22. `@nuxt/vite-builder` moved from cssnano `^7.1.9` (4.4.5) to `^8.0.1` (4.4.6), and Nuxt 4.4.6 raised its own engines from `^20.19.0 || >=22.12.0` to `^22.12.0 || ^24.11.0 || >=26.0.0`. Dev E2E still passes because development does not minify CSS. Nothing Ayme-owned failed.

## Conclusion

- Ayme's integrations run on Node 20.19.0. The requirement Ayme passes to consumers is `unplugin@3`'s `^20.19.0 || >=22.12.0`, and it holds for both paths.
- Next path: Node 20.19 works with Next 16.0.0 through at least 16.3.4. Next 16 declares `>=20.9.0`.
- Nuxt path: Node 20.19 works only with Nuxt 4.0.1–4.4.5. From 4.4.6, Nuxt itself requires Node 22.12+, and from 4.5.0 Node 22.19+. Every Nuxt release with the 2026-06 and 2026-07 security fixes (4.4.7+, 4.5.1+) needs Node ≥ 22.12, so a patched Nuxt on Node 20 is not possible.
- Node 20 has been upstream EOL since 2026-04-30.
- Nodes below 20.19 were not probed; the observed constraint does not call for it.

## Reproduce

1. Download and verify Node 20.19.0 for your platform from `https://nodejs.org/dist/v20.19.0/`.
2. Fill in the placeholders in [`scripts/node20-run.sh`](scripts/node20-run.sh) (`<node20>`: directory holding the extracted Node and a `shim/pnpm` copy of `pnpm-shim.sh`; `<logs>`: output directory) and in `pnpm-shim.sh` (the Devbox Node 24 binary and pnpm 11.24.0's `pnpm.mjs`).
3. In the worktree, set the candidate in the fixture's `package.json`, run `pnpm install` under Devbox, then `sh node20-run.sh next|nuxt <label>`.
