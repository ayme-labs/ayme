---
name: inspector-dogfood
description: >
  Verify a change to the Inspector by driving the Inspector itself through
  Ayme, as a coding agent: the fixture's dogfood page registers the panel's
  own Page Object, so its tools, structure and runs are visible through
  `ayme mcp`. Use when a change touches `packages/inspector` and before
  showing the change to the user.
---

# Dogfooding the Inspector

The Inspector normally hides from Ayme: a closed shadow root, a host the page
state ignores. The inspector-fixture app's `/dogfood.html` mounts it the other
way round, with `mountInspector({ dogfood: true })`: an open shadow root, the
Agent Connection on, and the Inspector's own Page Object (the one its tests
use, `@ayme-dev/inspector/testing`) registered beside the list app's. An agent
connected through `ayme mcp` then gets `Inspector.*` tools and sees the panel
in every snapshot and Change Record.

Use it to check a change the way an agent would meet it: open the panel,
switch lenses, open a run card, run a tool from the panel, read the Runs
timeline, and read the panel's own structure. It finds what the unit tests
and the e2e tests describe from the outside: tools that are not live, clicks
the panel swallows, noise in the page state.

## Procedure

Run every command inside the repository's Devbox shell.

1. Build what the page loads. The fixture compiles the Inspector's Page
   Object from source but loads the Inspector itself from its package build,
   so rebuild after changing `packages/inspector`:

   ```sh
   pnpm turbo run build --filter=@ayme-dev/inspector --filter=@ayme-dev/mcp
   ```

2. Serve the fixture on a port nobody else uses (other threads may be serving
   their own apps on this machine):

   ```sh
   cd apps/inspector-fixture && pnpm dev --port 4791 --strictPort
   ```

   Keep the process id; stop it by that id when done, never by pattern.

3. Register the monorepo's own MCP server with your agent, from the
   repository root, so the server matches the page client the fixture uses:

   ```sh
   claude mcp add ayme -- node "$PWD/packages/mcp/dist/cli.mjs" mcp
   ```

   Any other MCP client takes the same command and arguments. Restart the
   agent so it lists `ayme_connect`.

4. Connect: call `ayme_connect` with `http://127.0.0.1:4791/dogfood.html` and
   open the link it returns in a browser tool. The first load compiles the
   Page Object, one TypeScript Program per class, and takes up to half a
   minute. Without a browser tool, `startAgent` and `connectPage` from
   `@ayme-dev/mcp/testing` drive a Playwright page the same way.

5. Drive the panel through its tools and read what comes back:
   - `Inspector.open`, `Inspector.navigator.showLens` (Model, Structure,
     Tools), `Inspector.navigator.search`, `Inspector.navigator.tools.listed`;
   - `Inspector.tool` opens a run card; `Inspector.detail.toolPage.card.*`
     fills it; the generic `click` on the card's Run button runs the tool;
   - `Inspector.runs.showAll` and a `snapshot` show the Runs timeline with
     each run's steps and result;
   - `Inspector.structure.pick` and `Inspector.structure.memberOf` read the
     Structure lens.

   `ayme_list_tools` lists what is live right now; tools appear and
   disappear as views open and close, which is itself a check.

6. Read every result as a finding. A tool that is not listed means its Page
   Object member is not visible or not schema-able; a click that answers
   "intercepts pointer events" means the panel is in the way; a Change Record
   that is empty after a visible change means the page settled before the
   panel finished (see issue #495, a Settled Page waits for in-flight work).
   Take a `snapshot` when in doubt; it is the agent's view.

7. Stop the dev server by its process id and remove the MCP registration if
   it was only for this session.

## What the page does not show

- The Structure lens's tree and the search results stay out of the page
  state, since they render that state. Read them through the tools instead.
  A ref chooser's tree on a run card is a capture of the page, and stays in.
- Actions whose parameters the build plugin cannot schema (a `Record`, a rest
  parameter, a `string | boolean` union) are not tools. Use the generic
  Browser Tools on the run card for those.
- `Inspector.*` tools exist only on the dogfood page. A production mount
  keeps the whole panel out of the page state.

The page and its tests live in `apps/inspector-fixture` (`README.md`,
`tests/dogfood.spec.ts`). The guide for connecting an agent is
`docs/guide/guides/connect-an-agent.md`.
