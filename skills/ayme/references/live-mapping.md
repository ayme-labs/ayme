# Map a flow live

Map a user flow into a POM against the running app, in this order:

1. **Connect** to the app's page, as [Browser setup](browser-setup.md)
   describes.
2. **Discover** the flow with the built-in tools: `snapshot`, `click`, `fill`,
   as [Page tools](page-tools.md) describes. Note each surface's root, portaled
   content, which states change what's possible, and each step's visible
   outcome.
3. **Write the POM** from what you observed, following
   [Page object design](page-object-design.md). Get each locator from
   `generate_locator`: pass `groups`, one `{ within: <root ref>, targets: [...] }`
   per root, plus a group without `within` for page-level members. A ref
   belongs to one snapshot and does not belong in code.
4. **Verify** by calling each new action through Ayme's MCP server and
   confirming its effect on the page.
