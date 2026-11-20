# Map a flow live

Map a user flow into a POM against the running app, in this order:

1. **Connect** to the app's page with the browser automation you already use,
   and connect Ayme to it, as
   [Using Ayme with browser automation tools](browser-automation-tools.md)
   describes. Without any browser automation, start `ayme mcp` with
   `--browser-tools` and connect as [Browser setup](browser-setup.md)
   describes: its `snapshot`, Browser Tools and `generate_locator` then do
   the steps below.
2. **Discover** the flow with your browser automation: its snapshot, click
   and fill. Note each surface's root, portaled content, which states change
   what's possible, and each step's visible outcome.
3. **Write the POM** from what you observed, following
   [Page object design](page-object-design.md) and
   [Page Object Models](ayme-page-objects.md). Write each locator from the
   role and name the snapshot shows, such as
   `getByRole('button', { name: 'Create' })`, relative to its component's
   root. Only `ayme mcp --browser-tools` has `generate_locator`, which writes
   them for you. Example: after a click on New project, its snapshot showed

   ```
   - e4 button "New project"
   - e14 dialog "New project":
     - e15 textbox "Project name"
     - e16 button "Create"
     - e17 button "Cancel"
   ```

   `ProjectsPage` holds `newProjectButton`,
   `getByRole('button', { name: 'New project' })`. `NewProjectDialog` is
   rooted at `getByRole('dialog', { name: 'New project' })`, and its members
   are relative to that root, such as
   `getByRole('textbox', { name: 'Project name' })`.

   With `generate_locator`, pass one group per root, with the root's ref as
   `within`. Pass one more group, without `within`, for locators taken from
   the page, such as the page's own members and the dialog's root:

   ```json
   {
     "groups": [
       { "within": "e14", "targets": ["e15", "e16", "e17"] },
       { "targets": ["e4", "e14"] }
     ]
   }
   ```

   The result mirrors the input. Each group lists `{ target, locator }` per
   target, such as
   `{ "target": "e16", "locator": "getByRole('button', { name: 'Create' })" }`.
   A group's locators are relative to its `within`, ready to call on that
   component's `root`. A target that fails gets `{ target, error }`. A ref
   belongs to one snapshot and does not belong in code.

4. **Verify** with `page_objects`: each new Page Object shows where you
   expect it, with the children you declared. Then call each new action and
   confirm its effect, in its answer's `changes` or with your browser
   automation.
