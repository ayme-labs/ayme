## Writing rules down

- Write each rule once, next to the config or code that enforces it. Other docs, this file included, link to it rather than restate it.
- The code, its types and its tests say what the code does. A doc or a comment adds only what they cannot say.
- Every rule nothing enforces, and every comment, carries its reason on the same line, so a later reader can tell when it no longer holds.

## Repository map

- [ARCHITECTURE.md](ARCHITECTURE.md): what ayme is made of above any one package: the containers, who talks to whom, and what each environment runs. Read it before adding a package, a process boundary or a connection between them, and update it when a change moves one.
- [packages/](packages/): the ayme WebMCP product. A published package's README is its npm entry point; the consumer docs in [docs/guide/](docs/guide/) own its API and setup.
- Before adding or moving a source file in a package, read that package's AGENTS.md: [ayme](packages/ayme/AGENTS.md), [inspector](packages/inspector/AGENTS.md), [mcp](packages/mcp/AGENTS.md), [recorder](packages/recorder/AGENTS.md), [recorder-window](packages/recorder-window/AGENTS.md).
- [skills/](skills/): skills shipped to consumers for use in their own project. Read [skills/AGENTS.md](skills/AGENTS.md) before editing one.
- [apps/example-vue/](apps/example-vue/): the hosted playground where visitors try ayme before integrating it. A visitor installs only ayme's MCP server. Read [its README](apps/example-vue/README.md) before changing the app.
- [docs/testing.md](docs/testing.md): the test lanes and where test-only code lives. Read it before adding tests or test helpers, and read its [Local runs and CI](docs/testing.md#local-runs-and-ci) section before running anything beyond one package's tests.
- Before a pull request goes ready, follow the [change-analysis guidance](docs/testing.md#change-analysis).
- [docs/framework-integrations.md](docs/framework-integrations.md): what a framework integration ships, its behaviour contract and the files a new framework touches. Read it before adding or changing a framework integration.
- [docs/releasing.md](docs/releasing.md): how the published packages are versioned and released.
- [Experimental APIs](docs/guide/reference/experimental-apis.md): the APIs whose shape is not settled yet. Read [ADR-0037](docs/adr/0037-unsettled-apis-ship-marked-experimental.md) before marking an API experimental or graduating one.
- To move the supported `@playwright/test` range, edit [playwright-range.json](playwright-range.json) and run [playwrightRange.test.ts](packages/unplugin-ayme/src/playwrightRange.test.ts): it names every place that still states the old range.

## Agent skills

### Repo-local skills

Skills for agents working on this repository live in [.agents/skills/](.agents/skills/) (`.claude/skills` is a symlink to it). [skills/](skills/) holds the skills ayme ships to consumers.

- [inspector-dogfood](.agents/skills/inspector-dogfood/SKILL.md): verify a change under `packages/inspector` by driving the Inspector itself through `ayme mcp`, before showing the change to the user.
- [verify-recorder-lifecycle](.agents/skills/verify-recorder-lifecycle/SKILL.md): check a change under `packages/recorder/src` against the Recorder's TLA+ lifecycle model when it alters the order of events, what the recorder waits for, or a promise it makes, before showing the change to the user.
- [update-playwright-lite](.agents/skills/update-playwright-lite/SKILL.md): repin the Playwright Lite fork, or decide whether a Lite change goes upstream or into the fork.
- Refresh the vendored skills, those [skills-lock.json](skills-lock.json) lists, with `npx skills update -p` and review the change; leave them unedited otherwise, because a refresh can replace a hand edit. Keep [LICENSE-pstack](.agents/skills/LICENSE-pstack) in step with pstack's licence.

### Issue tracker

Before reading, filing or changing an issue, read [docs/agents/issue-tracker.md](docs/agents/issue-tracker.md).

### Triage labels

Before labelling an issue, read [docs/agents/triage-labels.md](docs/agents/triage-labels.md) for this tracker's label names.

### Domain docs

Before exploring an area of the codebase, read [docs/agents/domain.md](docs/agents/domain.md): it names the glossary and the ADRs to read first.

Before adding or renaming a term in [GLOSSARY.md](GLOSSARY.md), show the user the wording and wait for their explicit approval: a term becomes the name in code, docs and ADRs, so the owner chooses it.

### Architectural decisions

The rules for writing, replacing and retiring an ADR, and the list of those in force, are in [docs/adr/AGENTS.md](docs/adr/AGENTS.md).

## Commit types

Commit messages follow Conventional Commits. [commitlint.config.ts](commitlint.config.ts) defines the allowed types and when to use each; read it before choosing a type.

## Development environment

- Start a persistent Devbox shell and run every project command inside it: Devbox supplies the Node and pnpm the scripts and hooks expect. `devbox run -- <cmd>` runs from the repository root, whatever the current directory, so reach a package with `pnpm -C <dir> <script>` or `devbox run -- sh -c 'cd <dir> && <cmd>'`.
- If Devbox is unavailable, report that as a blocker instead of running project commands outside it: other tools may be other versions, so their results would mislead.
- In a Claude Code cloud container, run [prepare-cloud-checkout.sh](scripts/prepare-cloud-checkout.sh) from a checkout or worktree before its first commit, so its pre-commit hook passes; it also gives Playwright the Chromium build it expects. The session start hook runs it only in a session opened on this repository alone. A `pnpm install` that changes `node_modules` links the browser too, but an up-to-date one skips it.
