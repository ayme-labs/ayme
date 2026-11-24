---
name: inspector-dogfood
description: >
  Verify a change to the Inspector by driving the Inspector itself through
  ayme, as a coding agent: the fixture's dogfood page registers the panel's
  own Page Object, so its tools and runs are visible through `ayme mcp`
  beside Playwright MCP. Use when a change touches `packages/inspector` and before
  showing the change to the user.
---

# Dogfooding the Inspector

The Inspector normally hides from ayme: a closed shadow root, a host the page
state ignores. The inspector-fixture app's `/dogfood.html` mounts it the other
way round, with `mountInspector({ dogfood: true })`: an open shadow root, the
Agent Connection on, and the Inspector's own Page Object (the one its tests
use, `@ayme-dev/inspector/testing`) registered beside the list app's. An agent
connected through `ayme mcp` gets class tools such as `Inspector.open` and
`Navigator.showLens`, and sees the panel in `page_objects` and in what each
Page Object Tool's answer says changed. It drives and reads the rest of the
page with its own browser automation, here Playwright MCP.

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
   repository root, so the server matches the page client the fixture uses,
   and Playwright MCP beside it if your agent has no browser automation:

   ```sh
   claude mcp add ayme -- node "$PWD/packages/mcp/dist/cli.mjs" mcp
   claude mcp add playwright -- npx -y @playwright/mcp@<version>
   ```

   Any other MCP client takes the same commands and arguments. Restart the
   agent so it lists `ayme_connect`.

4. Connect: call `ayme_connect` with `http://127.0.0.1:4791/dogfood.html` and
   open the link it returns with Playwright MCP's `browser_navigate`. The
   first load compiles the Page Object, one TypeScript Program per class, and
   takes up to half a minute. Without an agent, `startAgent` and
   `connectPage` from `@ayme-dev/mcp/testing` drive a Playwright page the
   same way.

5. Drive the panel through its tools and read what comes back:
   - `Inspector.open`, `Navigator.showLens` (Model, Structure,
     Tools), `Navigator.search`;
   - `Inspector.tool` opens a run card; `RunCard.openArguments` and `RunCard.fillJson`
     fill it; Playwright MCP's `browser_click` on the card's Run button runs
     the tool;
   - `RunsView.showAll`, then `page_objects` or Playwright MCP's
     `browser_snapshot`, show the Runs timeline with each run's steps and
     result;
   - `StructureLens.pick` and `StructureLens.memberOf` read the
     Structure lens.

   `ayme_list_tools` lists what is live right now; tools appear and
   disappear as views open and close, which is itself a check.

6. Read every result as a finding. A tool that is not listed means its Page
   Object member is not visible or not schema-able; a click that answers
   "intercepts pointer events" means the panel is in the way; an answer with
   no `changes` after a visible change means the page settled before the
   panel finished (see issue #495, a Settled Page waits for in-flight work).
   Read `page_objects` when in doubt; it is the agent's view of the Page
   Objects.

7. Stop the dev server by its process id and remove the MCP registrations if
   they were only for this session.

## What the page does not show

- The Structure lens's tree and the search results stay out of the page
  state, since they render that state. `StructureLens.memberOf` reads
  the tree; it is the one read-only method that is a tool, because the
  page state does not show its answer. The other reads of the Page Object
  (the tool list, the run's steps, the theme) are plain test methods, since
  the page already shows what they return. A ref chooser's tree on a
  run card is a capture of the page, and stays in.
- Actions whose parameters the build plugin cannot schema are not tools.
  Use your browser automation on the run card for those.
- The Inspector's class tools exist only on the dogfood page. A production mount
  keeps the whole panel out of the page state.

The page and its tests live in `apps/inspector-fixture` (`README.md`,
`tests/dogfood.spec.ts`). The guide for connecting an agent is
`docs/guide/guides/connect-an-agent.md`.
