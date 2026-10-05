# Formbricks lab app

[Formbricks](https://github.com/formbricks/formbricks) as a lab app: a real product with hard UI to measure agents on, with Ayme in the page. The `ayme-labs/formbricks` fork is a git submodule at [`formbricks/`](./formbricks), pinned to an exact commit. It stays outside the pnpm workspace, and neither `git clone` (even with `--recurse-submodules`) nor `pnpm install` fetches it. Only `pnpm lab:prepare` does.

This lab app runs on a Mac only, by hand. It is never part of CI or `pnpm check`.

## Prerequisites

- Docker Desktop, running
- the Ayme Devbox shell, with this repository's dependencies installed (`pnpm install` at the root)
- free ports `3000` (Formbricks), `4000-4001`, `5432`, `6379`, `8025`, `1025`, `8080` and `9000-9001` (Formbricks's dev services)

## Commands

From this directory inside `devbox shell`:

```sh
pnpm lab:prepare
pnpm lab:dev
```

`lab:prepare` checks out the pinned submodule commit, builds and packs Ayme's `ayme`, `react`, `unplugin-ayme` and `mcp` packages from this checkout with `pnpm pack`, as they would be published, and unpacks them into the submodule's ignored `.ayme-lab/packages/` folder, where Formbricks's dependencies point. It then installs Formbricks's dependencies with the pnpm version Formbricks declares, and creates its ignored `.env` the first time. So the lab app always runs the Ayme commit this checkout is at: run `lab:prepare` again after changing Ayme, then restart `lab:dev`. It refuses to touch a dirty submodule checkout, and fails when the Ayme packages' dependencies no longer match the lockfile in the submodule; see [Moving the pin](#moving-the-pin).

`lab:dev` starts Formbricks's own dev stack: its services in Docker and the app at http://localhost:3000, in lab mode. It runs until you stop it with `Ctrl+C`. On the first start it also projects Formbricks's data into its authorization store and marks the survey scope ready, the state Formbricks's own CI calls production: a new survey starts restricted, and activating it asks who can view it. The marker lives in the Docker volume, so later starts skip this step.

The Docker services belong to one Compose project named `formbricks`, so every checkout of this repo on a Mac shares one lab stack and one port `3000`. Run `lab:dev` from one checkout at a time. The stack's authorization service is started with the secrets in the `formbricks/.env` of the checkout that first ran it, so before preparing another checkout, copy that `.env` into its `formbricks/` folder.

With `lab:dev` running, in a second Devbox shell:

```sh
pnpm lab:qualify
pnpm lab:smoke
```

`lab:qualify` qualifies the page objects against the running app with Formbricks's own Playwright. It seeds an isolated user, organization and workspace through Formbricks's database package and waits until Formbricks has copied them into its authorization store, signs in through the real UI, creates a survey from scratch, renames it, saves and closes it, and proves on each screen that every page object locator resolves to exactly one visible element. It also starts an `ayme mcp` server and checks that the page pairs with it by itself, that the server lists the page's tools, Ayme's Browser Tools and the screen's Page Object Tools, and that `goal` is among them only with the Goal Loop switch on. No other Ayme MCP server may listen on ports 9350 to 9365 while it runs, since a page pairs by itself only with exactly one.

`lab:smoke` runs Formbricks's own start-from-scratch Playwright scenario against the running app. At the pinned revision it can fail at sign-in: the scenario writes its user to Postgres and signs in at once, while Formbricks's background worker copies the user into the authorization store a second or more later. When it is sent to "create organization", that race is the cause, not the lab app. Formbricks's own CI runs the scenario against a production build. `lab:qualify` waits for that copy before it signs in.

After `Ctrl+C`, stop the Docker services:

```sh
pnpm lab:stop
```

`lab:stop` keeps the Docker volumes, so the data survives. There is no reset command, because deleting the volumes is destructive.

## Ayme in the lab app

One commit on the fork's `ayme-overlay` branch, the Ayme overlay, holds everything Ayme adds to Formbricks. The submodule pins that commit, `ad3a298`, whose parent is the upstream revision the lab app is based on, `8abe0b42`, the fork's `main` as of 2026-10-03. Its code lives in [`formbricks/apps/web/ayme/`](https://github.com/ayme-labs/formbricks/tree/ad3a29870b0f31799af672bfd8dce2b65505a2ca/apps/web/ayme):

- The React integration owns the runtime in Formbricks's root layout, with WebMCP publication on, so the page publishes Ayme's Browser Tools and `snapshot`, and with the Agent Connection on in lab mode (see below).
- Page objects for the screens the eval's mission touches, in `ayme/pom/`: `SignInPage`, `SurveyNavigationPage`, `SurveyEditorPage` and `SurveySummaryPage`. Each screen registers only its own, so the page publishes only that screen's Page Object Tools. Ayme's Turbopack loader compiles them, as in the [Next.js example](../example-next/README.md). The survey editor's question text is a rich-text editor without an accessible name, so its locator goes from the `Question*` label to the editor, as Formbricks's own Playwright helper does. The survey name input's accessible name is `Survey name`.
- A Decision Endpoint route at `/api/ayme/decisions` for the Goal Loop.

### Goal Loop switch

One build serves Ayme with the Goal Loop off and on. The Goal Loop is on for a page load when the browser sends the cookie `ayme-lab-goal-loop=on`; then the page also publishes `goal`. Without it the Goal Loop is off. The page reads the cookie when it loads, so set it before opening the page, for example with Playwright:

```ts
await context.addCookies([
  { name: "ayme-lab-goal-loop", value: "on", url: "http://localhost:3000" },
]);
```

### Decision Endpoint

The route calls the model with the OpenRouter key in `AYME_OPENROUTER_API_KEY`, the variable the live goal lane uses. Export it in the shell that runs `lab:dev`; without it the route answers `503` and `lab:dev` says so when it starts. Keep the key out of this folder: an agent under evaluation works in it.

The route appends one JSON line per decision request to a usage file: `time`, `durationMs`, `status`, `requestedModel`, `model`, `generationId` (OpenRouter's id for the call, the key to its own usage record of it), and `usage` with the model's `input_tokens`, `output_tokens` and `cost` in US dollars, or `null` when the request failed. The file is `formbricks/apps/web/.ayme-lab/decision-usage.jsonl`, which git ignores, unless `AYME_LAB_DECISION_USAGE_FILE` names another one, as an absolute path, when `lab:dev` starts. The location comes from the environment `lab:dev` started with and stays the same for every run, so a run's requests are the lines whose `time` falls within the run. `requestedModel` is the model the page asked for; `model` is the one that answered.

### Lab mode

`lab:dev` sets `AYME_LAB=1`. In lab mode the page turns the [Agent Connection](../../docs/guide/guides/connect-an-agent.md) on, gated on lab mode the way an app gates it on its dev flag, and Formbricks's content security policy allows the page client's loopback WebSocket. The page then pairs with a coding agent's `ayme mcp` server, from the `@ayme-dev/mcp` that `lab:prepare` packed: on `localhost` an open tab pairs by itself when exactly one Ayme MCP server runs, and otherwise through the link `ayme_connect` returns. The page's tools, `snapshot`, the Browser Tools, the screen's Page Object Tools and `goal` with the Goal Loop on, are then the agent's MCP tools. A `goal` call runs the whole Goal Loop inside one call, so give the agent a per-call limit of several minutes; the server itself waits for the page's answer.

## Moving the pin

To move the lab app to a newer Formbricks revision of the fork:

1. In `formbricks/`, fetch the fork and rebase the overlay commit onto the new revision: `git fetch origin && git rebase --onto <new-revision> <old-revision> ayme-overlay`.
2. Resolve conflicts. `pnpm-lock.yaml` is easiest to regenerate: take the new revision's lockfile, run `corepack pnpm@<Formbricks's pnpm> install --no-frozen-lockfile` with the Ayme packages unpacked (an earlier `lab:prepare` leaves them in `.ayme-lab/packages/`), and amend the overlay commit. Do the same when only the Ayme packages' dependencies changed.
3. Check that the overlay is still exactly one commit on top of the new revision, and push it: `git push --force-with-lease origin ayme-overlay`.
4. In this repository, stage the submodule at the overlay commit (`git add formbricks`), update the two revisions named in [Ayme in the lab app](#ayme-in-the-lab-app) and the overlay commit in its link to the code, and commit both.
5. Run `pnpm lab:prepare`, start `pnpm lab:dev`, and run `pnpm lab:qualify`. Fix any page object locator it reports in the overlay commit.
