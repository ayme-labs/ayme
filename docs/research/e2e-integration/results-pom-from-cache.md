# Page objects from e2e's cache (2026-10-06)

Local spike on Abel's Mac, nothing committed. Question: can e2e's cached clicks be turned into a proper Ayme page object, with names, members and children, and does Claude then use it?

**Input caveat:** the stock arm's cache came from the read-write "after rename" phase. It spells the button "Add project", because the pre-rename entries had been overwritten. The coding agent and the verify run therefore used the "Add project" UI. Both have been reverted.

## 1. Deterministic plan (free, no model)

`apps/ayme-spike/pom-from-e2e.ts --plan`; the output is in `.e2e/samples/pom-plan.json`.

- The 3 cache entries collapse to 1 distinct flow (same action hash), which gives class `ProjectsPage` and method `createProject(name)`, shared by all 3 tests.
- The instruction "create a project named {name}" was recovered from the test file by digest, because e2e stores only `instructionDigest`.
- Members: `addProjectButton`. There is one child candidate (container key "Add project") with `projectNameField` and `createButton`.
- End wait: `getByRole("listitem").filter({ hasText: name })`. A list item's accessible name doesn't come from its content, so the plan uses role plus text.
- Things it flagged for judgment:
  - "/" names no page, so the class name is a guess.
  - There were two end anchors. It kept the one that spells the parameter and flagged the incidental status "Publication: unavailable".
  - The container is known only by its first text, so its root and name need the app.

## 2. Repair patch from the repair proposals (free)

`pom-from-e2e.ts --repair .e2e/repairs <ProjectsPage>` matches each proposal's fallback clicks against the page object's locators:

```diff
- getByRole("button", { name: "New project" })
+ getByRole("button", { name: "Add project" })
```

All 3 proposals agree, and the patch is exactly the fix we applied by hand.

## 3. Coding agent (1 Sonnet session: 7 turns, 23 s, about $0.078)

- Headless Claude Code with the Evals Claude Code login, read at run time and never stored.
- Tools: Read, Write, Edit, Glob and Grep only, confined to a scratch directory. It had no shell and no web.
- Inputs: the plan, the example app's `main.tsx`, `CounterPage.ts` for conventions, and Ayme's page object and Playwright-in-the-browser docs.
- It never saw the hand-written `ProjectsPage`. The page object guide opens with that exact class, so the scratch copy swaps it for a neutral example.
- `generate_locator` was not used. It needs a browser tab connected to Ayme, and the spike's server runs with the Inspector off.

Generated:

```ts
@ayme({ description: "The new-project form that opens after Add project is clicked: a project name field and a Create button." })
export class NewProjectForm {
  readonly root: Locator; readonly projectNameField: Locator; readonly createButton: Locator;
  constructor(projectsSection: Locator) {
    this.root = projectsSection.locator("form");
    this.projectNameField = this.root.getByRole("textbox", { name: "Project name", exact: true });
    this.createButton = this.root.getByRole("button", { name: "Create", exact: true });
  }
  @ayme.action({ description: "Type the project name into the open new-project form and submit it with Create." })
  async submit(name: string) { await this.projectNameField.fill(name); await this.createButton.click(); }
}

@ayme({ description: "The Projects screen: open the new-project form, create a project by name, and see it appear in the project list." })
export class ProjectsPage {
  readonly projectsSection: Locator; readonly addProjectButton: Locator; readonly projectItems: Locator; readonly newProjectForm: NewProjectForm;
  constructor(page: Page) {
    this.projectsSection = page.getByRole("region", { name: "Projects", exact: true });
    this.addProjectButton = this.projectsSection.getByRole("button", { name: "Add project", exact: true });
    this.projectItems = this.projectsSection.getByRole("listitem");
    this.newProjectForm = new NewProjectForm(this.projectsSection);
  }
  @ayme.action({ description: "Create a project with the given name: open the Add project form, enter the name, submit it, and wait until the project appears in the list." })
  async createProject(name: string) {
    await this.addProjectButton.click();
    await this.newProjectForm.projectNameField.fill(name);
    await this.newProjectForm.createButton.click();
    await this.projectItems.filter({ hasText: name }).waitFor();
  }
}
```

## Generated vs hand-written

| | Hand-written | Generated |
|---|---|---|
| Class / method | `ProjectsPage.createProject(name)` | the same names, so the tool name is unchanged |
| Locators | 3 inline `page.getByRole` calls in the method | 4 named members, all scoped to region "Projects" |
| Child | none | `NewProjectForm`, rooted at the section's form, with its own `submit(name)` |
| End | returns after clicking Create | waits for the new list item |
| Descriptions | the action only | the class, the child and both actions |

## 4. Verify

- `tsc --noEmit` passes. `derivePomManifests` lists `ProjectsPage.createProject`, with `NewProjectForm` as a component.
- Adapter fix this surfaced: `derivePomManifests` also returns the child as its own class, so the adapter now publishes only top-level classes. Claude saw exactly one Ayme tool.
- Record with the generated page object and a fresh cache: 3 sessions, 9 turns, about $0.039. Claude called `ProjectsPage_createProject` in 3 of 3 steps, and each entry holds that single tool call.
- Replay: 3 of 3 replayed with 0 sessions, in 10.6 s.
- Afterwards the hand-written page object was restored (byte-identical to the backup), along with the "New project" button.

The paid total was 4 sessions, about $0.12 by the SDK's estimate.

## What needed judgment the cache couldn't give

The agent resolved each of these from the app's source:

- **The container:** the recording keys it by its first text, "Add project", which is the button that opens the form. The agent named the child after what it is (`NewProjectForm`) and rooted it at the form.
- **The class name:** "/" names no page. The agent kept `ProjectsPage` because `main.tsx` imports that name and the section is labelled "Projects".
- **The incidental "Publication" end anchor:** dropped.
- **Scoping to the Projects region:** the cache has no notion of a region unless something was recorded within it.
- **A child action:** it added `submit(name)` to the child, which the adapter doesn't publish because children are out of scope.

## Findings for an upstream ask

- Store the redacted instruction text in `recordedFor`, so the cache describes itself. Today only a digest is stored.
- Read-write fallback overwrites entries, which is how the pre-rename stock entries were lost. The page object arm now keeps its entries and writes repair proposals instead.

## Files on the Mac (uncommitted)

The scripts are `e2e-spike/apps/ayme-spike/pom-from-e2e.ts` and `pom-agent.mjs`. Samples are in `.e2e/samples/` (`pom-plan.json`, `repair-patch.json`, `ProjectsPage.generated.ts`). Run logs are in `.e2e/out/pom-agent/run.json` and `.e2e/out/claude/ayme-gen-*`.
