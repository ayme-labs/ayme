# Map a flow live

Map a user flow into a POM against the running app, in this order:

1. **Discover** the flow with the browser automation you already use: its
   snapshot, click and fill. Without any, add one first, such as Playwright
   CLI, Playwright MCP or agent-browser. When a Session is open, list the
   Page Objects on each new screen first, as the skill says. Note each
   surface's root, portaled content, which states change what's possible,
   and each step's visible outcome.
2. **Write the POM** from what you observed, following
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

3. **Verify** with a Session. At the project's first Page Object, set the
   project up first, as [Browser setup](browser-setup.md) says: a Session
   does not start without `ayme/page-objects.ts`. List a new class there
   unless a class it lists already reaches it. Start a Session on the
   same browser as your automation, as
   [Using ayme with browser automation tools](browser-automation-tools.md)
   describes. Keep it open across your edits: it takes them in, as
   [Sessions](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/connect-an-agent.md#sessions)
   says under Edits. Run `ayme page-objects`: each new Page Object shows
   where you expect it, with the children you declared. Then call each new
   action and confirm its effect, in its answer's `changes` or with your
   browser automation.
