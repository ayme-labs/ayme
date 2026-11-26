# Hidden tab spike (throwaway)

A test page and a Page Object whose `hideThen` action hides its own Tab (a
popup window, a link opened in a new tab) or waits while someone else hides it,
then takes one kind of step, to see what a Node Session's Run does on a hidden
Tab. Not a shipped example.

The behaviour under test is in `packages/mcp/src/node-session/visibility.ts`
(its variants are environment variables, listed at its top) and the
`AYME_SPIKE_FOCUS` variant in `background.ts`; each part of a Run is logged
through `spikeRunGate.timed` in `packages/ayme`.

## Running it

1. Build `@ayme-dev/ayme` and `@ayme-dev/mcp`.
2. Serve this folder: `python3 -m http.server 8766 --bind 127.0.0.1`.
3. Start a Session from this folder, with `AYME_CACHE_DIR` and `AYME_SPIKE_LOG`
   set inside a scratch folder: `ayme open http://127.0.0.1:8766/ [--headless]
--cdp-port <port>`, or `ayme attach` to Playwright CLI, agent-browser or
   Playwright MCP as the dialog spike's README says.
4. `SPIKE_SCRATCH=<folder> node drivers/case.mjs <cdp endpoint> <way> <step> [n] [stallMs]`
   runs one case n times after a warm-up; `drivers/end.mjs` drives the
   `AYME_SPIKE_HIDDEN=end` variant and `drivers/pwmcp.mjs` drives Playwright
   MCP itself.
