# Map a flow live

Map a user flow into a POM against the running app, in this order:

1. **Connect** to the app's page, as [Browser setup](browser-setup.md)
   describes.
2. **Discover** the flow with the built-in tools: `snapshot`, `click`, `fill`.
   Note each surface's root, portaled content, which states change what's
   possible, and each step's visible outcome.
3. **Write the POM** from what you observed, following
   [Page object design](page-object-design.md).
4. **Verify** by calling each new action through Ayme's MCP server and
   confirming its effect on the page.
