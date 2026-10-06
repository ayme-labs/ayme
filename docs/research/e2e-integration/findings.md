# tester-army/e2e and Ayme

Read from tester-army/e2e at fd3a0c7 (2026-10-05): `docs/cache.mdx`, `docs/tools.mdx`, `docs/executors.mdx`, `docs/reference/config.mdx#cache`, `docs/reference/mcp.mdx`, `docs/migrate/playwright.mdx#page-objects`, `packages/e2e/src/cache/{trace,identity}.ts`. Apache-2.0, pre-1.0.

## What their cache actually stores

- One JSON entry per passing `agent.act()` step, written only after a later check (locator assertion, `agent.assert`) passes. Format `trace-1` (`cache/trace.ts`).
- Each action is a grammar verb (`tap`, `type`, `select`, `check`, `navigate`, ...) on a **semantic target descriptor**: role, name, text, testId, placeholder, a `within` container key, a position among twins. Not CSS or XPath. A structural selector is kept as provenance only.
- Plus postconditions: start/end route, up to 8 controls that appeared and 8 that went away, a 300-char summary.
- Key (`cache/identity.ts`): project, **testId**, target, engine major.minor, instruction digest, params digest, **callIndex within the test**, agent name and context digest, app identity.

So your concern holds, with one correction: the locators are already semantic (role + name), so the loss is not "raw locators" but **no names, no reuse, no structure**:

1. **No sharing.** testId is in the key. "log in as admin" in 20 tests is 20 entries. When the login form changes, all 20 miss, and the model re-solves it 20 times (then each re-records on its own pass).
2. **No meaning.** An entry is "tap button 'New project', type 'x' into textbox 'Project name'". Nothing says this is `ProjectsPage.createProject(name)`. The instruction text itself is not even stored, only its digest.
3. **No composition.** No children, collections or roots; a row action is stored as `within` + position, not as "item `ref`.archive()".
4. **Silent drift.** A replay that still finds every control never refreshes; a stale one hands off to the model quietly unless `--strict-cache`.

## Question 1: could Ayme support e2e?

Yes, cheaply, because Ayme POMs are Playwright POMs and e2e's web engine is Playwright (pinned 1.63).

Three levels, from cheapest:

**a. Ayme POMs as e2e project tools (no upstream change).** e2e lets you add AI SDK tools to an agent via `defineTool(tool, { mutates })` and reach the Playwright page via `surfaceOf(engine).page()` (`@e2e-dev/web`). An `@ayme-dev/e2e` helper could turn each `@ayme.action` into a tool (`ProjectsPage.createProject`), so `agent.act('create a project named X')` calls the POM action instead of clicking around.
- Catch 1: a mutating project tool is a cache **gap** (`docs/tools.mdx`, `ToolGapAction`): replay stops there and the model runs that part live. So today, POM tools make e2e's cache *worse*, not better.
- Catch 2: tool input schemas come from Ayme's build plugin. Node-side test code has no plugin pass, so the helper needs a schema source (run unplugin's extractor over the POM files, or a TS-type reader).
- Catch 3: `surfaceOf().page()` bypasses e2e's action authorization, redaction and per-action recording. Fine for trusted POM code, but e2e would not see the clicks inside.
- Web only; e2e mobile targets have no Playwright page.

**b. Trace to POM converter (no upstream change).** Read `.e2e/cache/*.json` and draft POM methods: each descriptor maps 1:1 to `getByRole(role, { name })`, `getByTestId`, `getByPlaceholder`; `within` becomes a scoped locator; `unique()`/params become method args. Naming needs the test source (instruction text is not in the entry, only its digest) or a model pass. Output is a reviewable `@ayme.action` method. This is a codegen tool, not a live integration.

**c. Ayme as an e2e engine (`writing-an-engine.mdx`).** Drive the page through Ayme's in-page runtime instead of Playwright. Not worth it: their web engine already does Playwright well, and we would gain nothing a test runner needs.

## Question 2: could e2e save its cache as page objects?

Not with what they ship. `cache.store` is pluggable (`read(keyHash)`, `write(keyHash, trace)`, `delete`), but the store only sees the key hash, so it cannot recognise "same step, different test" on a read it has never seen written. Deduping or redirecting needs the runner's help.

What would have to change upstream, smallest first:

1. **Replayable tool calls.** A `defineTool(..., { mutates: true, replay: 'args' })` annotation: record the tool name and arguments in the trace, replay by calling the tool again. Then a step solved with `ProjectsPage.createProject({ name })` caches as that one call, and the POM, not the cache, owns the clicks. One fix to the POM repairs every flow. This is the key ask and it is generic (not Ayme-specific), so it has a fair chance upstream.
2. **A shared step scope.** An option to key by instruction + params (+ start route) instead of per test, so identical steps share one entry. Smaller win, riskier for them (context differs between tests).
3. **Promote trace to POM.** A hook after a verified recording (`onRecorded(trace, instruction)`) so a plugin can write or update a POM method. Builds on 1: once promoted, later runs call the POM tool.

## Recommendation

- Build (a) + (b) as one small `@ayme-dev/e2e` adapter only if e2e's traction matters to Ayme's positioning; it is a few hundred lines and shows the pitch "your e2e agent steps become page objects".
- Before building, open one upstream issue on tester-army/e2e proposing **replayable tool calls** (point 1). Without it, Ayme tools in e2e cost model calls on every replay, which undercuts the integration. Their docs already say "a mutating project tool cannot be replayed", so the ask is concrete.
- Do not do the engine route (c).

Nothing was built or filed; this is research only.
