# Inject spike (throwaway)

Can a standalone Ayme browser bundle, injected by browser automation, pair with
`ayme mcp` and serve Page Object tools on a page that does not ship Ayme?

Yes, with two conditions on a public https page: the automation must turn on
`bypassCSP` and grant `local-network-access`. Never merge this to main.

```
src/inject.ts       the bundle entry: createAyme({ agentConnection: true }), then
                    registers Notes (on /notes*) or PageHeading (anywhere else)
src/Notes.ts        Page Object of site/notes.html; VERSION is the edit marker
src/PageHeading.ts  trivial Page Object for any public site
vite.config.ts      one IIFE, dist/ayme-inject.js (about 4.6 MB, 1 MB gzip)
scripts/drive.mjs   plays the agent: MCP SDK clients to `ayme mcp` and to
                    Playwright MCP (@playwright/mcp 0.0.84, --config with
                    browser.initScript), over stdio
scripts/webmcp-check.mjs  side check of Playwright MCP's WebMCP tool collection
```

## Rerun

From the repository root, inside Devbox, after `pnpm install` and `pnpm build`:

```sh
devbox run -- pnpm -C apps/inject-spike build
# Playwright MCP 0.0.84 wants Chromium build 1252 (Chromium 157):
node apps/inject-spike/node_modules/@playwright/mcp/cli.js install-browser chromium
devbox run -- sh -c 'cd apps/inject-spike && node scripts/drive.mjs --headless'
```

`drive.mjs` flags: `--target <url>` (default the local notes page on
127.0.0.1:4710), `--headless`, `--channel chrome`, `--bypass-csp`,
`--grant-lna`, `--init baked|loader`, `--scenario basic|nav|edit|probe`,
`--next <url>` (nav), `--wait-ms`. `ayme mcp` listens on 4720. Each step
prints one JSON line.

Strict-CSP matrix, as run:

```sh
for args in "" "--bypass-csp" "--grant-lna" "--bypass-csp --grant-lna"; do
  devbox run -- sh -c "cd apps/inject-spike && node scripts/drive.mjs --headless \
    --wait-ms 10000 --target https://github.com/microsoft/playwright $args"
done
```

Drop `--headless` for headed, add `--channel chrome` for installed Chrome, add
`--scenario probe` to read the page's own view of Local Network Access.

Duplicate runtime: serve the mcp-fixture app
(`cd apps/mcp-fixture && pnpm exec vite --config app/vite.config.ts --port 4730`)
and pass `--target http://127.0.0.1:4730/`.

The findings are in the thread report, not here. The Playwright CLI run
(`scripts/drive-cli.mjs`) and the bundle size breakdown (`scripts/size/`) are
in `CLI-AND-SIZE.md`.
