# Ayme on a forked e2e: caching and building page objects

Follow-up to [findings.md](findings.md). Code references are tester-army/e2e at fd3a0c7 (`packages/e2e/src/...`) and ayme-labs/ayme main.

## The idea in one paragraph

Today e2e's cache stores *how* a step was done (clicks on role/name targets), once per test. We flip it: the *how* lives in an Ayme page object, shared by every test, and e2e's cache only stores *which* page object action was called, with which arguments. When the UI changes, one page object method breaks and gets fixed once; every flow that calls it is fixed. Traces the agent records by clicking are the raw material we turn into new page object methods.

```
agent.act("create a company named {name}")
   │  first run: no POM yet → agent clicks → trace recorded
   ▼
ayme pom from-e2e  ── turns the trace into CompaniesPage.createCompany(name)  (reviewed diff)
   │
   ▼
next run: agent sees the tool CompaniesPage.createCompany → calls it
   │  cache records { tool: "CompaniesPage.createCompany", args: { name: {{param:/name}} } }
   ▼
replay: calls the POM method, no model.  UI changed? method throws → agent re-solves once
   → repair proposal for that one method → every test that uses it is fixed
```

## What we'd build (four pieces)

### 1. Ayme adapter for e2e (`@ayme-dev/e2e`, no fork needed)

Turns Ayme page objects into e2e project tools.

- **Metadata:** `derivePomManifests(file)` is already exported from `@ayme-dev/unplugin-ayme` (`derivePomManifests.ts`). It gives tool names, descriptions and input schemas from source, so no build plugin pass is needed in Node. The `@ayme` decorators are runtime no-ops (`decorators.ts`), so the classes run in Node as plain Playwright page objects.
- **Page:** `surfaceOf(engine).page()` from `@e2e-dev/web` gives the current attempt's Playwright `Page`; construct the POM with it per call.
- **Tools:** each `@ayme.action` becomes `defineTool(tool({ description, inputSchema, execute }), { mutates: true })`, named `CompaniesPage.createCompany`.

```ts
// e2e.config.ts
import { aymeTools } from '@ayme-dev/e2e';
const engine = web();
export default {
  targets: [{ engine, app: { url: APP_URL } }],
  agents: { default: { model, tools: aymeTools(engine, ['src/pom/*.ts']) } },
} satisfies E2EConfig;
```

Limits for a first version: web targets only (mobile has no Playwright page); top-level actions and single children only. Collections (`ListPage.items.archive` takes a Structural Ref) need a different handle in e2e, for example the item's name text, which is what e2e's own `within` key is.

On stock e2e this works but pays model calls on every replay: a mutating project tool is recorded as a gap (`cache/recorder.ts` `recordGap`, `agent/replay.ts` `case 'tool'` → `gap`), so replay stops there and hands the step to the model.

### 2. Fork patch: replayable tool calls (the "cache POM" change)

The smallest change that makes e2e cache page object calls. Five touch points:

| File | Change |
| --- | --- |
| `agent/tool.ts` | New annotation `replay: 'call'` next to `mutates` (default stays "gap"). |
| `cache/trace.ts` | `ToolGapAction` gets optional `tool` and `args` (JSON); validation accepts them. Bump to `trace-2`. |
| `agent/action-dispatcher.ts` `runTool` | For a `replay: 'call'` tool, record `{ name: 'tool', tool, args }` instead of a bare gap. Needs the call's args, which the tool loop has. |
| `cache/template.ts` | Run `unique()` templating over `args` too, so `{ name: "E2E 17280 Co" }` is stored as `{{param:/name}}`. `mapTraceText` already walks trace text; extend it to args. |
| `agent/replay.ts` `planCall` | `case 'tool'` with `tool` set → plan a call that runs the project tool through `runTool` with filled-in args. `ReplayHost` gets the step's project tools. |

End-state checks (`endAnchors`, `endPath`) stay as they are, so a POM call that "succeeds" without the effect still hands off. A tool that throws on replay is `action-failed` → hand-off, exactly like a missing button today.

Why this is enough to answer your concern: the cache entry per test is now one line ("called createCompany with name"), so there is nothing per test to re-evaluate. The expensive, fragile part is the POM method, and there is one of it.

This is also the patch to offer upstream: it is generic (any deterministic project tool benefits), not Ayme-specific.

### 3. POM from cache: `ayme pom from-e2e` (codegen)

How I imagined building page objects from their cache. Input: `.e2e/cache/*.json` entries. Output: a reviewable diff adding `@ayme` classes and methods.

**Step by step:**

1. **Read traces.** Each entry is `{ actions[], startPath, endPath, endAnchors, goneAnchors, summary, recordedFor }` (`cache/trace.ts`).
2. **Map each action to Playwright.** The mapping is mechanical because descriptors are already semantic:

   | Trace action | Generated code |
   | --- | --- |
   | `tap` `{ role, name }` | `page.getByRole(role, { name }).click()` |
   | target with `testId` | `page.getByTestId(testId)` (preferred, like Playwright's ranking) |
   | target with `placeholder` / `text` | `getByPlaceholder` / `getByText` |
   | `type` / `typeSecret` | `.fill(value)` / `.fill(secret arg)` |
   | `select`, `check`, `press`, `hover`, `upload`, `drag` | `selectOption`, `setChecked`, `press`, `hover`, `setInputFiles`, `dragTo` |
   | `navigate` / `back` | `page.goto(url)` / `page.goBack()` |
   | `within: "Acme Inc"` | scoped: `page.getByRole('row', { name: item }).getByRole(...)`, and `item` becomes a parameter |
   | `position: { index, of }` | `.nth(index)` (flagged in the diff as fragile) |
   | point actions, `tool` gaps | not generated; the method is left out with a note |

3. **Parameters.** `unique()` values are already placeholders in the trace (`{{param:/name}}`, also `|uri`, `|form`, `|slug`), so each placeholder becomes a method parameter. Ordinary params are stored as literals today; fork tweak below.
4. **End state becomes a wait.** The first `endAnchor` becomes a final `await page.getByRole(...).waitFor()`, so the method returns only when its effect is visible. That keeps the POM honest the same way their end checks keep replay honest.
5. **Class.** Pick the class from `startPath`: `/companies` → `CompaniesPage`, `/settings/billing` → `BillingSettingsPage`. If an existing Ayme POM already owns those locators (compare against `derivePomManifests` + its source), add the method there instead of creating a class.
6. **Dedupe across tests.** Normalize each trace (placeholders in, literals out) and hash its action list. Same hash from 20 tests → one method. This is the step that collapses "log in as admin" × 20 into `LoginPage.logIn(user)`.
7. **Name and describe.** One model call per new method: given the instruction text and the action list, return `{ class, method, description }`. One-time cost at codegen, not per run.
8. **Emit a diff**, never overwrite hand-written code silently.

Example. Test:

```ts
await app.open('/companies');
await agent.act('create a company named {name} on the {plan} plan', { params: { name: unique(name), plan: 'Pro' } });
```

Trace (shortened):

```json
{ "startPath": "/companies",
  "actions": [
    { "name": "tap",    "target": { "role": "button",   "name": "New company" } },
    { "name": "type",   "target": { "role": "textbox",  "name": "Company name" }, "value": "{{param:/name}}" },
    { "name": "select", "target": { "role": "combobox", "name": "Plan" }, "value": "{{param:/plan}}" },
    { "name": "tap",    "target": { "role": "button",   "name": "Create" } } ],
  "endAnchors": [ { "role": "heading", "name": "{{param:/name}}" } ] }
```

Generated:

```ts
@ayme
export class CompaniesPage {
  constructor(private readonly page: Page) {}

  @ayme.action({ description: "Create a company with the given name on the given plan." })
  async createCompany(name: string, plan: string) {
    await this.page.getByRole("button", { name: "New company" }).click();
    await this.page.getByRole("textbox", { name: "Company name" }).fill(name);
    await this.page.getByRole("combobox", { name: "Plan" }).selectOption(plan);
    await this.page.getByRole("button", { name: "Create" }).click();
    await this.page.getByRole("heading", { name }).waitFor();
  }
}
```

The same class then works everywhere Ayme works: Inspector, `ayme mcp`, WebMCP, Goal Loop, and back in e2e as a tool through piece 1.

**Fork tweaks that make codegen much better** (small, recording-only; key unchanged):

- Store the instruction text in `recordedFor` (today only `instructionDigest`). Without it, naming has to parse test files.
- Store every param as a placeholder in the recording, not only `unique()` ones (`{{param:/plan}}` above would otherwise be the literal `"Pro"`). The key still digests ordinary param values, so cache behavior doesn't change.
- Store the route per action. Then one long `act` that crosses pages ("log in, add to cart, check out") splits into one method per page.

### 4. Repair loop

When a replayed POM call fails (button renamed), e2e hands off and the agent finishes the step by clicking, which records a fresh trace for that instruction. `ayme pom from-e2e` sees: instruction mapped to `CompaniesPage.createCompany`, the call failed, and here is what worked. It proposes a patch to that one method (old vs new action list, usually one locator). One fix, all flows. This is the direct answer to "flows that use the same steps have to be re-evaluated by AI".

## Things I'd not do

- **A custom `cache.store` that writes POM files.** The store's `read(keyHash)` must return a trace, and it only sees a hash, so it can't share across tests or serve a POM back. It would be a codegen in the wrong place.
- **Promote inside the runner on every passing run.** Writing source files during test runs makes CI non-deterministic. Codegen stays an explicit command with a diff.
- **Ayme as an e2e engine.** Their Playwright engine is fine; nothing to gain.

## Later, if the above works

- **Goal Loop as an e2e executor.** e2e already ships a Jev decision executor (`@e2e-dev/decision`, `docs/decision-models.mdx`) that picks one operation per step from the tree, same idea as our Goal Loop. Ours would add Page Object Tools as operations. Worth a comparison once pieces 1 and 2 exist.

## Smallest experiment that proves it

1. Fork tester-army/e2e (Apache-2.0) into ayme-labs, apply piece 2 (the replayable tool call patch). It is a moving pre-1.0 repo (last commit 2026-10-05), so keep the patch small and rebase often.
2. Write piece 1 against one Ayme example app (`apps/example-react`, `ProjectsPage.createProject`).
3. Three e2e tests that each start with "create a project named {name}".
4. Run read-write, then rename the "New project" button.
   - Stock e2e: three misses, three model re-solves, three re-recordings.
   - Fork + Ayme: one failing POM method; fix it once (or via the repair proposal), zero model calls on the next run.
5. Then piece 3 on the stock-e2e traces from step 4, to show the POM can come from the cache in the first place.

That run gives a concrete number for the pitch: model calls after a UI change, N tests sharing a step, stock vs POM-backed.

---

# Round 2 (Abel's questions, 2026-10-06)

## How the adapter looks and how it's used

```ts
// e2e.config.ts
import { aymeTools, aymeFixtures } from '@ayme-dev/e2e';
const engine = web();
const poms = { engine, files: ['src/pom/**/*.ts'] };

export default {
  targets: [{ engine, app: { url: APP_URL } }],
  agents: { default: { model, tools: aymeTools(poms) } },
} satisfies E2EConfig;

// tests/fixtures.ts
export const test = base.extend(aymeFixtures(poms)); // { projectsPage, companiesPage, ... }
```

Inside, per marked action:

```ts
defineTool(
  tool({
    description: manifest.description,            // from derivePomManifests
    inputSchema: jsonSchema(manifest.inputSchema), // same schema WebMCP gets
    execute: (input) => {
      const pom = new ProjectsPage(surfaceOf(engine)!.page());
      return pom.createProject(...manifest.parameters.map((p) => input[p.name]));
    },
  }),
  { mutates: true /*, replay: 'call' with the fork patch */ },
);
```

Two ways tests use it:

```ts
// 1. Agent picks the action: same test as today, the model sees ProjectsPage_createProject next to tap/type
await agent.act('create a project named {name}', { params: { name: unique(name) } });

// 2. Deterministic: the page object straight from a fixture, no model at all
test('rename a project', async ({ projectsPage, screen }) => {
  await projectsPage.createProject('Alpha');
  await expect(screen.getByRole('listitem', { name: 'Alpha' })).toBeVisible();
});
```

Detail: model providers only accept tool names matching `[a-zA-Z0-9_-]`, so `ProjectsPage.createProject` is offered as `ProjectsPage_createProject` (or `ProjectsPage__createProject`, if a class name can contain `_`).

Same POM files serve Ayme in the browser (Inspector, `ayme mcp`, WebMCP, Goal Loop) and e2e in Node, unchanged.

## Would POM-from-cache work?

The mechanical half, yes: descriptors map 1:1 to Playwright locators, `unique()` slots map to parameters, end anchors map to a final wait. A pure CLI gets you working but mediocre page objects. Where it falls short:

- **Names and grouping need judgment.** "Which class owns this button" and "what is this method called" are not in the trace.
- **Coverage is only what tests did.** The POM has methods for the flows tests ran, nothing else.
- **Shared chrome.** A header nav button shows up in traces on every route. A route-based CLI puts a copy in every page class; it should be one `AppHeader` child.
- **Data in containers.** `within: "Acme Inc"` is a parameter only when "Acme Inc" came from params. Otherwise it is test data baked into the POM.
- **Fragile targets.** Unnamed controls recorded by position become `.nth()`; they should be flagged, not hidden.
- **Long acts.** One `act` that crosses pages needs the per-action route (fork tweak) to split.

So: deterministic extraction, then a coding agent finishes it.

## How the agent comes up with page objects and names

Split the job:

1. **Deterministic skeleton** (`ayme pom from-e2e --plan`): cluster traces, dedupe action lists, collect every distinct locator with where it was used, propose names from accessible names (`button "New company"` → `newCompanyButton`, `textbox "Company name"` → `companyNameInput`), mark containers (dialog, row, list item, form) as child candidates and repeated containers as collections. Output is a JSON plan, not code.
2. **Coding agent writes the POMs** with the `ayme` skill and `ayme mcp`, given the plan plus:
   - **the app's source**: route files and component names are the best class names there are (`CompanyForm.tsx` → `CompanyForm`, `app/companies/page.tsx` → `CompaniesPage`). This is the signal a test-only tool like e2e never has, and Ayme always has.
   - **existing POMs**: extend them instead of making new ones.
   - **the live page**: it opens it through `ayme mcp` and confirms each locator with `generate_locator` (`docs/guide/reference/browser-tools.md`), which also upgrades weak locators to a test id when one exists.
3. **Verify**: rerun the e2e tests with `aymeTools`. Each `act` should now replay as one POM call; anything that still clicks is a gap in the POM.

This fits the agent-writes-page-objects-live direction Ayme already has (`generate_locator`, and the planned skill section on writing a page object while exploring, issue 405); the cache is just another input.

## Locators as named members, not inline

Yes, and it is what Ayme's model already has: locator members, Page Object Children with a `root`, collections (`PomMemberManifest` in `packages/ayme/src/contracts.ts`), shown in the Inspector's Model lens. Codegen rules:

- Every distinct target within a class becomes a member; methods use members, never inline locators.
- A container the actions sat in (dialog, form, row) becomes a child POM whose `root` is the container's locator.
- Repeated containers (rows, cards) become a collection: an async method returning `Item[]`, matching Ayme's collection rule.
- Members used by several classes move to a shared child (`AppHeader`).

```ts
@ayme
export class CompaniesPage {
  readonly newCompanyButton: Locator;
  readonly createDialog: CreateCompanyDialog;

  constructor(private readonly page: Page) {
    this.newCompanyButton = page.getByRole("button", { name: "New company" });
    this.createDialog = new CreateCompanyDialog(page.getByRole("dialog", { name: "New company" }));
  }

  @ayme.action({ description: "Create a company with the given name on the given plan." })
  async createCompany(name: string, plan: string) {
    await this.newCompanyButton.click();
    await this.createDialog.submit(name, plan);
    await this.page.getByRole("heading", { name }).waitFor();
  }
}

@ayme
export class CreateCompanyDialog {
  readonly nameInput: Locator;
  readonly planSelect: Locator;
  readonly createButton: Locator;

  constructor(readonly root: Locator) {
    this.nameInput = root.getByRole("textbox", { name: "Company name" });
    this.planSelect = root.getByRole("combobox", { name: "Plan" });
    this.createButton = root.getByRole("button", { name: "Create" });
  }

  @ayme.action({ description: "Fill in and submit the new company form." })
  async submit(name: string, plan: string) {
    await this.nameInput.fill(name);
    await this.planSelect.selectOption(plan);
    await this.createButton.click();
  }
}
```

### Going further: the cache points at members too

A second fork option: when the agent clicks by itself (no POM action fits), the recorder checks whether the clicked element is a known POM member and records `{ pom: "CompaniesPage", member: "newCompanyButton" }` instead of `{ role, name }`. Replay resolves the member through the POM. Then fixing one locator heals every recording that touched it, even steps that never became a POM action. Costs more than the tool-call patch (the recorder must evaluate POM locators against the clicked element on each action), so it's a second experiment after the tool-call one.

## Repair loop (built in the local spike, model-free)

- A replayed page object call that fails keeps its cache entry unchanged. The passing fallback is written as a repair proposal, `.e2e/repairs/<tool>-<keyHash>.json`, which holds the tool, the args, the error and the fallback actions.
- Replayed tool calls get a 5 s budget, and the executor is told which call failed so it does not retry it.
- Read-write run after renaming "New project": 3 re-solves, entries byte-identical, 3 proposals, 21 s (it was 187 s with 30 s timeouts). After the `ProjectsPage` fix: 0 re-solves.
- Rough edges: proposal args hold this run's values rather than the slot, the fallback starts with the failed call's gap, and every cache shares one repairs directory.

## No-fork integration (Abel's question, 2026-10-06 16:04)

Can Ayme work with e2e without changing e2e's source? Yes, in two layers that both use e2e's public extension points. What changes is where the page object cache lives.

**Layer 1: page objects as e2e tools (adapter, stock e2e).** `aymeTools(engine, globs)` turns every `@ayme.action` into `defineTool(..., { mutates: true })`. The agent uses them; in our runs Claude picked them whenever they fit, and a page object step took 3 turns against 5 for clicks. Limit: stock e2e records a mutating tool call as a cache gap, so every run pays the model for that step. Semantics at record time, no free replay.

**Layer 2: our own executor caches the calls.** e2e lets a project supply a `StepExecutor` with `runStep(ctx)`, and we need one anyway for Claude Code (e2e has no Claude subscription support). With `cache: 'inherit'`, e2e replays plain clicks itself and calls our executor only on a miss or at a gap, passing `ctx.replayedPrefix`. The executor keeps its own small store of page object calls:

1. On a step, look up the step (test id, call index, instruction digest, params digest, or instruction plus page object for cross-test sharing) in our store.
2. Hit: call the method with the filled-in args, with a 5 s budget, and verify (the method's own `waitFor` and the test's next check). Done, no model.
3. Miss or failed call: run the Claude session. Record which tool it called and with what args, with `unique()` values as placeholders. On a failed call, keep the entry and write the repair proposal.

e2e's own cache either writes a gap entry for the step (call through `runTool`) or records nothing for it (direct page object call); either way the step reaches our executor on every run, where our store replays the call. Pure-click steps keep using e2e's cache as today.

**What we lose without the fork**

- e2e's cache report counts page object steps as gaps, and `--strict-cache` flags them. Our executor would report its own hits.
- e2e's end-anchor check doesn't cover the call. We rely on the method's own wait and the test's assertions.
- Click steps keep e2e's container-name weakness (the counter keyed by its count). That's e2e's bug, and page object steps don't have it.
- `unique()` placeholders: an executor sees plain param values, not the markers, so our store maps args back to param names by matching values at record time. That works for our cases but is weaker than e2e's templating.
- Verified writes: e2e writes a recording only once a later check in the test passes. Our store would write when the step passes and rely on the test's own assertions.
- Mixed steps (a click plus a page object call in one act): e2e replays the click part and hands off at the gap, so our store must pick up mid-step from `ctx.replayedPrefix`. Doable, but fiddly.
- The patch's `replay: 'call'`, keep-on-failure and `replayTools` become unnecessary. The instruction text stays unavailable from the cache; the codegen keeps reading it from the test file by digest.

**To verify before trusting it:** what e2e records when our executor completes a step through a tool call rather than its grammar (expected: a gap entry, as today), and that `ctx.replayedPrefix` plus the ledger give the session enough context. Both are model-free checks on an unpatched checkout.
