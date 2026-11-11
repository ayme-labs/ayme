# Formbricks lab app

[Formbricks](https://github.com/formbricks/formbricks) as a lab app: a real product with hard UI to measure agents on. The app itself ships no Ayme. It is unmodified Formbricks, a git submodule at [`formbricks/`](./formbricks) pinned to an exact upstream commit. Ayme's Page Objects for it live in this folder, and an `ayme mcp` server builds them and loads them into the page from outside, as in [Page Objects on a page without Ayme](../../docs/guide/guides/page-objects-without-ayme.md).

```
.ayme/                 what ayme mcp serves when it starts in this folder
  page-objects.ts      the entry: the Page Objects of the screens
  no-page-objects.ts   an entry without Page Objects
  pom/                 the Page Objects
formbricks/            the Formbricks submodule
scripts/               the lab:* commands
tests/                 the Page Object qualification and its seed
playwright.config.ts   the qualification's Playwright config
```

The submodule stays outside the pnpm workspace, and neither `git clone` (even with `--recurse-submodules`) nor `pnpm install` fetches it. Only `pnpm lab:prepare` does.

This lab app runs by hand, on a Mac or in the [Formbricks eval workflow](../../.github/workflows/eval-formbricks.yml) on a hosted runner (see [the eval README](../eval-formbricks/README.md#on-a-hosted-runner)). Its Page Objects and its qualification are linted and type-checked with the rest of the repository, but nothing in CI or `pnpm check` starts it.

## Prerequisites

- Docker Desktop, running
- the Ayme Devbox shell, with this repository's dependencies installed (`pnpm install` at the root). The lab app starts only inside it: the pinned Formbricks needs Node 24 and its own pnpm, 11.7.0, which Devbox supplies through Corepack, and outside it `lab:dev` stops at Formbricks's check of the pnpm version, as it did on Node 22 with pnpm 11.24.0.
- free ports `3000` (Formbricks), `4000-4001`, `5432`, `6379`, `8025`, `1025`, `8080` and `9000-9001` (Formbricks's dev services)

## Commands

From this directory inside `devbox shell`:

```sh
pnpm lab:prepare
pnpm lab:dev
```

`lab:prepare` checks out the pinned submodule commit, installs Formbricks's dependencies from its own lockfile with the pnpm version Formbricks declares, and creates its ignored `.env` the first time. It then builds the Ayme packages this package depends on, `@ayme-dev/ayme`, `@ayme-dev/mcp` and `@ayme-dev/webmcp`, from this checkout. It refuses to touch a dirty submodule checkout, and puts nothing of Ayme into it.

`lab:dev` starts Formbricks's own dev stack: its services in Docker and the app at http://localhost:3000. It runs until you stop it with `Ctrl+C`. On the first start it also projects Formbricks's data into its authorization store and marks the survey scope ready, the state Formbricks's own CI calls production: a new survey starts restricted, and activating it asks who can view it. The marker lives in the Docker volume, so later starts skip this step.

The Docker services belong to one Compose project named `formbricks`, so every checkout of this repo on a Mac shares one lab stack and one port `3000`. Run `lab:dev` from one checkout at a time. The stack's authorization service is started with the secrets in the `formbricks/.env` of the checkout that first ran it, so before preparing another checkout, copy that `.env` into its `formbricks/` folder.

With `lab:dev` running, in a second Devbox shell:

```sh
pnpm lab:qualify
pnpm lab:smoke
```

`lab:qualify` qualifies the Page Objects against the running app with this repository's Playwright, whose Chromium `pnpm exec playwright install chromium` installs. Each test starts an `ayme mcp` server in this folder and runs the init script it writes in every page, as [Ayme in the lab app](#ayme-in-the-lab-app) describes. It checks that the unmodified page pairs with the server by itself and that the server lists Ayme's Browser Tools and the sign-in screen's Page Object Tools and no other screen's, that with the entry without Page Objects it lists `snapshot` and the Browser Tools and no Page Object Tool, and that with `--webmcp` Chrome's `document.modelContext` lists the sign-in screen's Page Object Tool and `page_objects`. It then seeds an isolated user, organization and workspace through Formbricks's database package and waits until Formbricks has copied them into its authorization store, signs in through the real UI, creates a survey from scratch, and proves on each screen that every Page Object locator resolves to exactly one visible element. It also checks that a refused sign-in stays on the sign-in page with its message. In the editor it calls the Page Object actions through the server, as an agent does, and checks that each takes effect: `saveAsDraft` and `save` are refused in the editor a first survey opens in, and in the editor a draft opens in from the survey list `saveAndClose` and `save` are refused and `saveAsDraft` stores the new name and leaves the survey a draft, each refusal saying what the editor's own buttons make of the survey; then the new name, the new question text, and the summary after saving. It then closes the share dialog and reopens the survey in the editor, where `saveAsDraft` is refused because the survey is no longer a draft, and `save` stores a new name, leaves the survey published and keeps the editor open; and once the survey has a response, opens it again through the dialog that asks first. An action returns without waiting for the screen it leads to, so the qualification waits for each screen itself. Before that walk, a throwaway user walks the same screens with Playwright alone, because Turbopack compiles each route and each server action on its first use, which takes longer than `save` and `saveAsDraft` wait for theirs (see [Timeouts](#timeouts)). No other Ayme MCP server may listen on ports 9350 to 9365 while it runs, since a page pairs by itself only with exactly one.

But for that one test, marked `WEBMCP` in [`tests/page-objects.qualify.ts`](./tests/page-objects.qualify.ts), the qualification reads the page's tools from the server, not from `document.modelContext`: see [Ayme in the lab app](#ayme-in-the-lab-app).

`lab:smoke` runs Formbricks's own start-from-scratch Playwright scenario against the running app, with Formbricks's own Playwright. At the pinned revision it can fail at sign-in: the scenario writes its user to Postgres and signs in at once, while Formbricks's background worker copies the user into the authorization store a second or more later. When it is sent to "create organization", that race is the cause, not the lab app. Formbricks's own CI runs the scenario against a production build. `lab:qualify` waits for that copy before it signs in.

After `Ctrl+C`, stop the Docker services:

```sh
pnpm lab:stop
```

`lab:stop` keeps the Docker volumes, so the data survives. There is no reset command, because deleting the volumes is destructive.

## Ayme in the lab app

Formbricks runs as its upstream wrote it, at `8abe0b42`, the `main` of the `ayme-labs/formbricks` fork as of 2026-10-03. Everything of Ayme is in this folder and reaches the page from outside:

1. `ayme mcp`, started in this folder, finds [`.ayme/page-objects.ts`](./.ayme/page-objects.ts), builds it with the `@ayme-dev/ayme` of this checkout, and serves the build on its own loopback port. It rebuilds after each edit, and an open page swaps the new Page Objects in. Run `lab:prepare` again after changing Ayme itself, then restart `ayme mcp`.
2. As it starts it writes `.ayme/init-script.js`, which names its port. Git ignores the file.
3. The browser tool that opens the lab app runs that init script in every page, with `bypassCSP` on and the `local-network-access` permission granted. Formbricks's content security policy allows neither the served modules nor the server's loopback WebSocket, which is why `bypassCSP` is needed. With Playwright:

   ```ts
   const context = await browser.newContext({
     bypassCSP: true,
     permissions: ["local-network-access"],
   });
   await context.addInitScript({ path: ".ayme/init-script.js" });
   ```

   Playwright MCP and Playwright CLI take the same three settings in their config file, as [the guide](../../docs/guide/guides/page-objects-without-ayme.md#set-it-up) shows.

4. In the page, the init script loads Ayme's runtime and the Page Objects from the server and turns the [Agent Connection](../../docs/guide/guides/connect-an-agent.md) on. On `localhost` the tab then pairs with the server by itself when exactly one Ayme MCP server runs, and otherwise through the link `ayme_connect` returns. The page's tools, `snapshot`, the Browser Tools and the screen's Page Object Tools, are then the agent's MCP tools.

The served runtime starts with the Agent Connection only. It publishes nothing over WebMCP, so `document.modelContext` lists no Ayme tool, with or without Chrome's `--enable-features=WebMCP`. Started as `ayme mcp --webmcp`, the server writes an init script that also turns WebMCP publication on, which loads `@ayme-dev/webmcp` in the page: on a Chrome with that flag, `document.modelContext` then lists the screen's Page Object Tools and the read tool `page_objects`, while the server offers the same tools as before. The eval's arms through WebMCP run it so. Started as `ayme mcp --only-page-object-tools`, the server lists those same tools and nothing else, neither `snapshot`, a Browser Tool nor a tool of its own, and answers them as WebMCP publishes them; the eval's arms whose agent gets the server run it so (see [the eval README](../eval-formbricks/README.md#how-ayme-reaches-the-page)).

### Page Objects

The Page Objects cover the screens the eval's missions touch, in [`.ayme/pom/`](./.ayme/pom), written to Ayme's [Page Object design rules](../../skills/ayme/references/page-object-design.md): `SignInPage`, `SurveyNavigationPage`, `SurveyEditorPage` and `SurveySummaryPage`, with the summary's `EditActiveSurveyDialog` and `ShareSurveyDialog`, which composes a generic `Modal`. Each page extends `AppPage`, which makes it present on its own path, so the entry lists all of them and the page offers only the current screen's Page Object Tools. A Page Object knows itself and its own declared children, and nothing of another screen. So an action waits only for what its own page shows of the outcome and then returns: `Modal.close` for its dialog to go, `SurveyEditorPage.save` and `saveAsDraft` for their button to show its name again, `SignInPage.logIn` for its own error message. An action that leads to another screen clicks and returns that screen's Page Object without waiting for it, so its tool description still names the Page Object the page shows next; whatever drives the browser waits for the page to load, and the agent takes a new snapshot. The editor has three save actions, and Formbricks shows the button of each only in some states:

| Editor                                                      | `save`                    | `saveAndClose`                     | `saveAsDraft`           |
| ----------------------------------------------------------- | ------------------------- | ---------------------------------- | ----------------------- |
| a draft, in the editor a first survey opens in (`?mode=cx`) | unavailable               | publishes it                       | unavailable             |
| a draft, opened from the survey list                        | unavailable               | unavailable                        | saves it, still a draft |
| a published survey, opened from its summary                 | saves it, still published | saves it and closes to the summary | unavailable             |

An action is unavailable where its button is not. Its reason says why and nothing else: it tells from the page's own buttons whether the survey is a draft and which editor it is in, and states that, with the buttons named as Formbricks labels them. It does not tell the agent what to call.

### Timeouts

In the page, a click, a fill or a wait gives up after one second, Ayme's default action timeout, and the lab app leaves that as it is. No action waits for the screen it leads to, so none needs longer for it. Two waits name a limit of their own:

- `SurveyEditorPage.save` and `saveAsDraft` wait up to five seconds for their save, a round trip to the server that took 0.5 to 0.75 seconds on a warm dev server, too close to one second.
- `SignInPage.logIn` waits one second for its error message, which a refused sign-in showed after 0.3 seconds, and takes a sign-in without one to have gone through. That is Ayme's own limit, named so that Playwright, which has none, waits no longer when it drives the Page Object.

On a fresh dev server Turbopack compiles each route and each server action on its first use, which took 15 to 25 seconds per screen when measured on four cores, so visit the screens once before an agent uses the Page Object Tools. `lab:qualify` and the eval's warm-up do.

### Lab switches

The entry `ayme mcp` serves is the lab app's one switch. The `ayme-lab-page-objects` and `ayme-lab-goal-loop` cookies went with the Ayme overlay: Formbricks reads neither, so setting them changes nothing.

- **Page objects.** On with the default entry, `.ayme/page-objects.ts`. Off with `ayme mcp --page-objects .ayme/no-page-objects.ts`, an entry that lists no Page Object: the page then offers `snapshot` and the Browser Tools, and no Page Object Tool. That is Ayme in an app without Page Objects.

The lab app has no Goal Loop and no Decision Endpoint.

## Moving the pin

The submodule pins an upstream Formbricks commit, with nothing of Ayme on top, so moving it needs no rebase and no commit in the fork. The submodule's URL is the `ayme-labs/formbricks` fork, so the commit has to be in the fork: sync the fork's `main` with upstream first when it is newer than that.

1. Run `pnpm lab:prepare` if `formbricks/` is not checked out. In `formbricks/`, fetch and check out the new commit: `git fetch origin && git checkout <new-commit>`.
2. In this repository, stage the submodule at that commit (`git add formbricks`) and update the revision named in [Ayme in the lab app](#ayme-in-the-lab-app).
3. Run `pnpm lab:prepare`, start `pnpm lab:dev`, which applies Formbricks's new database migrations, and run `pnpm lab:qualify`.
4. Fix what the qualification reports, here: a Page Object locator in `.ayme/pom/`, or the seed in [`tests/seed.ts`](./tests/seed.ts), which writes a user, an organization and a workspace straight into Formbricks's database and so follows its schema.
5. Commit the submodule, the README and the fixes together.

The fork's `ayme-overlay` branch, which held Ayme inside Formbricks up to `51ceaa4`, is no longer used.
