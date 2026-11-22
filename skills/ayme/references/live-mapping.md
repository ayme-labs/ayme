# Map a flow live

Map a user flow into a POM against the running app, in this order:

1. **Connect** to the app's page with the browser automation you already use,
   and connect ayme to it, as
   [Using ayme with browser automation tools](browser-automation-tools.md)
   describes. Without any browser automation, add one first, such as
   Playwright MCP or Playwright CLI.
2. **Discover** the flow with your browser automation: its snapshot, click
   and fill. Note each surface's root, portaled content, which states change
   what's possible, and each step's visible outcome.
3. **Write the POM** from what you observed, following
   [Page object design](page-object-design.md) and
   [Page Object Models](ayme-page-objects.md). Write each locator from the
   role and name the snapshot shows, such as
   `getByRole('button', { name: 'Create' })`, relative to its component's
   root. Example: after a click on New project, its snapshot showed

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

4. **Verify** with `page_objects`: each new Page Object shows where you
   expect it, with the children you declared. Then call each new action and
   confirm its effect, in its answer's `changes` or with your browser
   automation.
