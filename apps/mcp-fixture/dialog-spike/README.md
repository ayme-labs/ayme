# Dialog spike (throwaway)

A test page whose buttons open a `confirm`, an `alert` and a `prompt`, and a
Page Object for it, to see what a Node Session does when a JavaScript dialog
opens during a Page Object Action. Not a shipped example.

The behaviour under test is in `packages/mcp/src/node-session/dialogs.ts`
(its variants are environment variables, listed at its top) and the gate in
`packages/ayme/src/runs/infrastructure/pageInstrumentation.ts`.

## Running it

1. Build `@ayme-dev/ayme` and `@ayme-dev/mcp`.
2. Serve this folder: `python3 -m http.server 8765 --bind 127.0.0.1`.
3. Open `http://127.0.0.1:8765/` in Playwright CLI (with
   `--remote-debugging-port=9333` in its config) or agent-browser, mark the
   tab and run `ayme attach` from this folder, as the `ayme-cli` skill in
   `apps/eval-formbricks/spike` says. Set `AYME_SPIKE_LOG` to a file to get
   the event log.
4. `SPIKE_SCRATCH=<folder> node drivers/scenario.mjs <pw|ab> <tool> <accept|dismiss|none> [n] [promptText]`
   runs one case n times; `drivers/pwmcp.mjs` drives Playwright MCP itself.
