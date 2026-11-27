---
name: inspector-dogfood
description: >
  Verify a change to the Inspector by driving the Inspector itself: a
  Session of the `ayme` command runs the panel's own Page Objects on the
  inspector-fixture app's dogfood page, beside Playwright CLI. Use when a
  change touches `packages/inspector`, and before showing an Inspector
  change to the user.
---

# Dogfooding the Inspector

The dogfood page, `apps/inspector-fixture/app/dogfood.html`, mounts the
Inspector in an open shadow root beside the fixture's list app. The fixture's
`apps/inspector-fixture/ayme/page-objects.ts` lists the list app's Page Object
and the Inspector's own, the ones its tests use. A Session started in
`apps/inspector-fixture` runs both: `ayme page-objects` shows the panel in the
Page Object Tree, `ayme tools` lists its Page Object Tools, and `ayme call`
drives it. Playwright CLI, attached to the Session's browser, does what no
tool does, such as pressing a run card's Run button.

Driving the panel the way an agent drives it finds what the unit and
end-to-end tests miss: a tool that is not live, a click the panel swallows,
noise in the Page Object Tree, an answer that reports no change after you saw
the page change.

## Procedure

Run each command from the repository root inside Devbox, as
`devbox run -- <command>` or in a persistent Devbox shell. Two scripts of the
fixture run a tool in the fixture's folder:

- `pnpm -s -C apps/inspector-fixture ayme <command>` runs this checkout's
  build of the `ayme` command. Below it is written `ayme <command>`.
- `pnpm -s -C apps/inspector-fixture playwright-cli <command>` runs Playwright
  CLI at the version the script pins. Below it is written
  `playwright-cli <command>`.

Pass `-s=dogfood` to both on every command, so this run's Session and
Playwright CLI session stay apart from other agents' on this machine.

1. **Build what the page and the Session load.** The page loads the Inspector
   from its package build, and the `ayme` script runs the build of
   `packages/cli`. Rebuild after every change under `packages/inspector`:

   ```sh
   pnpm turbo run build --filter='@ayme-dev/inspector-fixture^...' --filter=@ayme-dev/cli --concurrency=2
   ```

   Done when Turbo reports every task successful.

2. **Serve the fixture on a port of its own.** Other threads serve their own
   apps on this machine. Check that `lsof -iTCP:4791 -sTCP:LISTEN` prints
   nothing, then start the server in the background:

   ```sh
   pnpm -C apps/inspector-fixture dev --port 4791 --strictPort
   ```

   Note the server's process id: `lsof -tiTCP:4791 -sTCP:LISTEN` prints it.
   You stop it by that id at the end.

3. **Start the Session and attach Playwright CLI.**

   ```sh
   ayme -s=dogfood open http://127.0.0.1:4791/dogfood.html
   playwright-cli -s=dogfood attach --cdp=<address>
   ```

   `<address>` is the one `ayme open` prints. The first load of the page
   compiles the Inspector's Page Object, which can take half a minute.

4. **Drive the panel, and read each answer.** Read `ayme page-objects` before
   each call that takes an `id`: the ids are the Session's, and a page load
   gives new ones. `ayme tools` lists what is live now. Tools appear and go
   as views open and close, such as the `RunCard` tools once a run card opens,
   and that is a check in itself. Cover at least:

   - **Open the panel and switch lenses**: `Inspector.open`, then
     `Navigator.showLens` with `{"id": "<Navigator's id>", "args": {"name": "Tools"}}`,
     and `Navigator.search`.
   - **Open a run card and run a tool from the panel**:
     `Inspector.tool` with `{"name": "ListPage.addItem"}` opens the card;
     `RunCard.fill` with `{"id": "<RunCard's id>", "args": {"args": {"text": "Milk"}}}`,
     or `RunCard.fillJson`, fills it. Press Run with
     `playwright-cli -s=dogfood click "getByRole('button', { name: 'Run', exact: true })"`.
     In the headless window the floating panel covers the list app's Add item
     button, so the run fails with "intercepts pointer events". Unless that is
     what you check, dock the panel first: `LayoutMenu.choose` with
     `{"choice": "Dock right"}`.
   - **Read the Runs**: `RunsView.showAll`, then `ayme page-objects`. The
     `runs: RunsView` entry holds each Run's arguments, Interactions, and its
     result or error.
   - **Read the Structure lens**: `Navigator.showLens` with `Structure`. Then
     `StructureLens.memberOf` and `StructureLens.pick` take a ref from the
     lens's tree, such as `e5`.
   - **Read the panel's own structure**: `ayme page-objects` shows it under
     `Inspector`; `playwright-cli -s=dogfood snapshot` shows the whole page.

   Done when each of these has run and you have read its answer against what
   the page shows.

5. **Read every answer as a finding.** A tool that is missing means its Page
   Object member is not visible, or its parameters have no schema. "intercepts
   pointer events" means the panel is in the way. An answer with no change
   after a change you saw means the page settled before the panel finished.

6. **Stop what you started, by name and by id**:

   ```sh
   playwright-cli -s=dogfood detach
   ayme -s=dogfood close
   kill <server's process id>
   ```

   Done when `ayme list` names no `dogfood` Session and
   `lsof -iTCP:4791 -sTCP:LISTEN` prints nothing.

## What the Session sees differently

The page's own runtime and the Session are two Hosts of the page, each with
its own Page Object Ids.

- The panel's Runs show the page runtime's Runs: those from the panel and
  from WebMCP. A Run of `ayme call` runs in the Session and is not there.
- The page runtime keeps the Structure lens's tree and the search results out
  of its page state, since they render that state. The Session's Page Object
  Tree shows them.
- A method of the Inspector's Page Object that is not an action, such as
  `RunCard.run`, has no tool, and neither has an action whose parameters
  have no schema. Use Playwright CLI for those.

This skill drives only the dogfood page. The fixture's Inspector Page Object
finds the panel with plain CSS, which pierces the dogfood page's open shadow
root but not the closed one of any other mount, such as the page
`ayme inspect` points at.

The page and its tests live in `apps/inspector-fixture`: see
`apps/inspector-fixture/README.md`, and
`apps/inspector-fixture/tests/dogfood.spec.ts`, which drives the panel through
WebMCP. `docs/guide/guides/connect-an-agent.md` covers Sessions.
