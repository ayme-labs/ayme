# Map a flow live

Map a user flow into a POM against the running app, in this order:

1. **Connect** to the app's page, as [Browser setup](browser-setup.md)
   describes.
2. **Discover** the flow with the built-in tools: `snapshot`, `click`, `fill`,
   as [Page tools](page-tools.md) describes. Note each surface's root, portaled
   content, which states change what's possible, and each step's visible
   outcome.
3. **Write the POM** from what you observed, following
   [Page object design](page-object-design.md) and
   [Page Object Models](ayme-page-objects.md). Get each locator from
   `generate_locator`. Example: after a click on New project, the snapshot
   showed

   ```
   - e4 button "New project"
   - e20 dialog "New project":
     - e21 textbox "Name"
     - e22 button "Create"
   ```

   `ProjectsPage` holds `newProjectButton`. `NewProjectDialog` is rooted at
   `e20`. Pass one group per root, with the root's ref as `within`. Pass one
   more group, without `within`, for locators taken from the page, such as
   the page's own members and the dialog's root:

   ```json
   {
     "groups": [
       { "within": "e20", "targets": ["e21", "e22"] },
       { "targets": ["e4", "e20"] }
     ]
   }
   ```

   The result mirrors the input. Each group lists `{ target, locator }` per
   target, such as
   `{ "target": "e22", "locator": "getByRole('button', { name: 'Create' })" }`.
   A group's locators are relative to its `within`, ready to call on that
   component's `root`. A target that fails gets `{ target, error }`. A ref
   belongs to one snapshot and does not belong in code.

4. **Verify** by calling each new action through Ayme's MCP server and
   confirming its effect on the page.
