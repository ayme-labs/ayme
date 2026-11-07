# Playwright CLI and bundle size (spike follow-up, 2026-11-07)

Two questions: does injecting Ayme through Playwright CLI work the same way
as through Playwright MCP, and why is the injected bundle 1 MB gzipped?

## 1. Playwright CLI

**Verdict: it works the same way as Playwright MCP, with the same config
file and the same two conditions on github.com.** I found no difference in
behaviour. Every console error matched the Playwright MCP run.

Tested with `@playwright/cli` 0.1.23 (`playwright-cli`), which bundles
`playwright-core` 1.65.0-alpha-2026-10-30. The CLI used its own Chromium
build; no extra install step was needed on this Mac.

### How the CLI takes an init script, `bypassCSP` and the permission

`playwright-cli` has no `--init-script`, `--bypass-csp` or `--grant-permissions`
flag. `playwright-cli open --help` lists only `--browser`, `--config`,
`--device`, `--headed`, `--idle-timeout`, `--mobile`, `--persistent` and
`--profile`. It does take `--config <path>`, which defaults to
`.playwright/cli.config.json` in the project and `~/.playwright/cli.config.json`
globally. That config has the same schema as Playwright MCP's config, and
`browser.initScript` and `browser.contextOptions` both work:

```json
{
  "browser": {
    "browserName": "chromium",
    "isolated": true,
    "launchOptions": { "headless": true },
    "contextOptions": {
      "bypassCSP": true,
      "permissions": ["local-network-access"]
    },
    "initScript": ["/abs/path/dist/ayme-inject.js"]
  }
}
```

So an agent only needs that file in `.playwright/cli.config.json`, or must pass
`--config` to `open`. Other commands in the same session (`-s=<name>`) reuse
the browser that `open` started.

### The flow, as an agent runs it

`scripts/drive-cli.mjs` plays the agent: an MCP SDK client to `ayme mcp`
(port 4720), and one `playwright-cli -s=ayme-spike …` shell command per
browser step:

1. `ayme_connect { url }`, which returns `<url>#ayme=ws://127.0.0.1:4720/<id>`
2. `playwright-cli open --config=<cfg> [--headed] <link>`
3. list `ayme mcp`'s tools until the page's tools appear
4. `playwright-cli eval …` and `playwright-cli console debug`
5. call the Page Object tool through `ayme mcp`, then `snapshot`
6. edit scenario: rebuild with `VERSION = "v2"`, then `playwright-cli reload`
   and call again; then `playwright-cli tab-new <url>` and call again
7. `playwright-cli close`

```sh
devbox run -- pnpm -C apps/inject-spike build
npm i -g @playwright/cli@0.1.23   # or pass --cli <path to playwright-cli>
devbox run -- sh -c 'cd apps/inject-spike && node scripts/drive-cli.mjs --headless'
# flags: --cli <path> --target <url> --headless --bypass-csp --grant-lna
#        --init baked|loader --scenario basic|edit --wait-ms <ms>
```

### Results (13 runs)

| Target                          | Mode     | Init   | bypassCSP | LNA | Page tools              | Page Object call          |
| ------------------------------- | -------- | ------ | --------- | --- | ----------------------- | ------------------------- |
| local notes page                | headless | baked  | –         | –   | 16 + `Notes.*`          | `Spike notes (v1)`        |
| local notes page                | headed   | baked  | –         | –   | 16 + `Notes.*`          | `Spike notes (v1)`        |
| local notes page                | headless | loader | –         | –   | 16 + `Notes.*`          | `Spike notes (v1)`        |
| local notes page                | headed   | loader | –         | –   | 16 + `Notes.*`          | `Spike notes (v1)`        |
| github.com/microsoft/playwright | headless | baked  | no        | no  | none                    | –                         |
| github.com                      | headless | baked  | yes       | no  | none                    | –                         |
| github.com                      | headless | baked  | no        | yes | none                    | –                         |
| github.com                      | headless | baked  | yes       | yes | 16 + `PageHeading.read` | title and `🎭 Playwright` |
| github.com                      | headed   | baked  | yes       | yes | 16 + `PageHeading.read` | same                      |
| github.com                      | headless | loader | yes       | yes | 16 + `PageHeading.read` | same                      |
| github.com                      | headed   | loader | yes       | yes | 16 + `PageHeading.read` | same                      |

The bundle runs in every case: `window.__aymeSpike` reports `started: true,
runs: 1, registered: "interactive"`. On github.com only the connection fails,
with these console errors:

- no `bypassCSP`: `Connecting to 'ws://127.0.0.1:4720/<id>' violates the
following Content Security Policy directive: "connect-src 'self' uploads.github.com …"`
  (15 console errors)
- `bypassCSP` without the permission: `WebSocket connection to
'ws://127.0.0.1:4720/<id>' failed: Error in connection establishment:
net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS` (repeated)
- both set: no Ayme errors; only GitHub's own 404 on
  `_global-navigation/payloads.json` and 503s from `collector.github.com`

Headed with both set, no permission prompt appeared, and pairing succeeded the
same way it did headless.

Edit scenario (local page, headless):

| Init   | After `reload` | After `tab-new` in the same session |
| ------ | -------------- | ----------------------------------- |
| baked  | `v1` (stale)   | `v1` (stale)                        |
| loader | `v2`           | `v2`                                |

As with Playwright MCP, the baked script is read once, when the browser
context opens. With Playwright CLI even a new tab keeps the old Page Objects;
only `close` and a fresh `open` would read the file again (I did not run that
step). The loader picks the edit up on reload.

One harness note, not a CLI problem: my first driver ran `playwright-cli`
with a synchronous `execFileSync`, which blocked the Node process that also
serves the local page, so `open` hung until its 60 s timeout. The driver now
runs commands asynchronously.

## 2. Bundle size

**Verdict: the 1 MB gzip comes from two things.** First, the build is not
minified (`minify: false` in `vite.config.ts`). Second, the IIFE inlines every
lazily imported part of Ayme: an IIFE cannot split code, so the Inspector UI,
the screenshot renderer and the MIME table all load eagerly. In that Inspector
UI, one dependency stands out. The Inspector's own build ships **all 1,867
lucide icons** (566 KB minified) although its source imports only 17.

The shipped file is 4,589,733 B (4.6 MB) with no minification, 997 KB gzip
(Vite's figure), or 962 KB with `gzip -9`. Minifying alone, with the same
contents (`vite build --minify`), brings it to 2.33 MB and 683 KB gzip.

### Top contributors

Bytes are attributed by chaining source maps through each package's `dist`.
The "gzip cost" column is the drop in the whole bundle's `gzip -9` size when
that group's bytes are removed. 72 KB of the minified bundle (the IIFE glue)
maps to no source.

| Group                                                                        | min KB | gzip cost KB (min) | unminified KB | gzip cost KB (unminified) | Needed by an injected agent setup?                                                |
| ---------------------------------------------------------------------------- | ------ | ------------------ | ------------- | ------------------------- | --------------------------------------------------------------------------------- |
| lucide-react (icons)                                                         | 569    | 139                | 698           | 147                       | No: Inspector UI only                                                             |
| Playwright Lite: locator chunk (injected script, selector and aria engines)  | 436    | 127                | 696           | 169                       | Yes: core                                                                         |
| Playwright Lite: snapdom (`@zumer/snapdom` 3.4.0, the DOM-to-image renderer) | 279    | 92                 | 324           | 104                       | Only for Ayme's own `screenshot` page tool, which the browser tool already covers |
| Inspector (`packages/inspector` + design-system)                             | 184    | 57                 | 355           | 87                        | No: Inspector UI                                                                  |
| react-dom                                                                    | 174    | 53                 | 409           | 81                        | No: Inspector UI only                                                             |
| Playwright Lite: index                                                       | 101    | 29                 | 197           | 40                        | Yes                                                                               |
| Radix UI and its helpers (floating-ui, react-remove-scroll, …)               | 91     | 29                 | 188           | 41                        | No: Inspector UI only                                                             |
| ayme (without the Goal Loop)                                                 | 83     | 28                 | 141           | 38                        | Yes                                                                               |
| zod                                                                          | 81     | 23                 | 135           | 29                        | Yes (tool schemas)                                                                |
| core                                                                         | 41     | 12                 | 70            | 16                        | Yes                                                                               |
| Playwright Lite: MIME table                                                  | 37     | 10                 | 40            | 10                        | Only for file upload without a MIME type                                          |
| ayme Goal Loop (`src/goal-loop`)                                             | 29     | 11                 | 44            | 12                        | Probably not, when the agent drives                                               |
| tailwind-merge                                                               | 27     | 9                  | 47            | 10                        | No: Inspector UI only                                                             |
| @trpc/client + server                                                        | 20     | 5                  | 31            | 6                         | Yes (the `ayme mcp` link)                                                         |
| sugar-high (code highlighting)                                               | 10     | 4                  | 19            | 6                         | No: Inspector UI only                                                             |
| mcp page client                                                              | 10     | 4                  | 18            | 5                         | Yes                                                                               |
| react, scheduler                                                             | 11     | 3                  | 22            | 4                         | No: Inspector UI only                                                             |
| WebMCP (`packages/webmcp`)                                                   | 3      | 1                  | 5             | 1                         | No, with `ayme mcp` as the path                                                   |
| spike Page Objects                                                           | 3      | 1                  | 5             | 1                         | Yes                                                                               |

What removing groups would leave (bytes cut from the built file, not a rebuild,
so this is an estimate):

| Bundle                                                                                                | min KB / gzip KB | unminified KB / gzip KB |
| ----------------------------------------------------------------------------------------------------- | ---------------- | ----------------------- |
| everything (today)                                                                                    | 2,274 / 657      | 4,482 / 962             |
| without the Inspector UI (Inspector, design-system, lucide, React, Radix, tailwind-merge, sugar-high) | 1,205 / 361      | 2,735 / 581             |
| also without snapdom and the MIME table                                                               | 890 / 259        | 2,371 / 466             |

The Inspector UI is 47% of the minified bundle and about 45% of its gzip
size. The Goal Loop and WebMCP are small (about 12 KB gzip together).

### Why every lucide icon ships

`packages/inspector/tsdown.config.ts` bundles `lucide-react`, a
devDependency, into `dist/index.mjs`. In that output each icon becomes a
top-level `createLucideIcon(__iconData$X)` call. The call has no pure
annotation, so tree shaking cannot drop it, and lucide's
`"sideEffects": false` no longer applies once its code is inlined into the
Inspector's own file. All 1,867 icons end up in `packages/inspector/dist/index.mjs`
(2.2 MB). This is not specific to the injected bundle: any app that builds with
the Inspector likely pays the same cost in its lazily loaded Inspector chunk.
That is an inference from the dist file; I did not build an app to confirm it.

### How the breakdown was made

```sh
# same contents, plus source maps; the package dists rebuilt with maps so the chain reaches src
for p in core webmcp mcp ayme inspector; do pnpm -C packages/$p exec tsdown --sourcemap; done
cd apps/inject-spike
pnpm exec vite build --sourcemap --outDir <out>/raw            # 4,589.77 kB, gzip 997.38 kB
pnpm exec vite build --sourcemap --minify --outDir <out>/min   # 2,328.79 kB, gzip 682.83 kB
# attribution (needs the `source-map` package resolvable, e.g. from a dir with `npm i source-map source-map-explorer`)
node scripts/size/chain.cjs <out>/min/ayme-inject.js <out>/min.segs.json > <out>/min.chain.json
node scripts/size/marginal.cjs <out>/min/ayme-inject.js <out>/min.segs.json
node scripts/size/combo.cjs <out>/min/ayme-inject.js <out>/min.segs.json
# then rebuild the packages without --sourcemap
```

`source-map-explorer` 2 alone stops at the package `dist` files, because Vite
does not chain their maps. `chain.cjs` follows each `.map` file down to
`src` and `node_modules`. Playwright Lite ships without maps, so it is split by
its `dist` chunk. After restoring the package builds,
`dist/ayme-inject.js` rebuilt byte-identical
(sha1 `a63478837354fe558f8e8cf83e49ba17eb5cd2d2`).
