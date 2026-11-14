---
name: ayme
description: Set up Ayme in a consumer project, expose existing Page Object Actions, design Page Object Models for Ayme, connect a coding agent to the app's page through Ayme's MCP server and use its tools, or read app state the page does not show through Peek Tools.
---

# Ayme

For package installation, application integration, or exposing an existing POM,
read [Onboarding](references/onboarding.md).

To connect yourself to the app's page with `ayme_connect`, when the page's tools
are missing from your tool list, or after a call the page didn't answer because
it reloaded, navigated or closed, or to give a page that doesn't ship Ayme
the project's Page Objects through Playwright MCP or Playwright CLI, read
[Browser setup](references/browser-setup.md). A connected page with its tools
listed needs no Browser setup.

When you use the page's tools, or a tool answers that it is unavailable or
gone, read [Page tools](references/page-tools.md).

When Playwright CLI, Playwright MCP or agent-browser drives the browser, read
[Browser automation tools](references/browser-automation-tools.md).

When `goal` is among your tools, read [Goal](references/goal.md).

For designing or restructuring Page Object Models, read
[Page object design](references/page-object-design.md) and
[Page Object Models](references/ayme-page-objects.md). Where they conflict with
the project's conventions, raise the conflict with the user.

For mapping a user flow into a POM against the running app, read
[Live mapping](references/live-mapping.md).

For registering Page Objects, placing or configuring the runtime owner, or
checking which tools are live, read
[Runtime integration](references/runtime-integration.md).

When debugging needs state the page does not show, such as unsaved edits,
component state or server data, or to add a Peek, read
[Peeks](references/peeks.md) before inferring that state from the page or the
source.

Follow the consumer project's existing POM conventions. The
[Ayme documentation](https://github.com/ayme-labs/ayme/blob/main/docs/guide/README.md) owns the APIs and the framework wiring;
read the page for the project's framework before editing that integration.
