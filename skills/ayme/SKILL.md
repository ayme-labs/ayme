---
name: ayme
description: Set up ayme in a consumer project, expose existing Page Object Actions, design Page Object Models for ayme, run the project's Page Object Tools with the `ayme` command beside Playwright CLI, Playwright MCP or agent-browser, or read app state the page does not show through Peek Tools.
---

# ayme

Read `ayme/CONVENTIONS.md` first, when it exists: what the user settled for
how ayme and its skills work in this repository. Read its opening part, which
holds for every skill, and its `ayme` section, and follow a line that points
to another file. It overrides this skill's defaults. When the user settles
something for every later run, write it under `ayme`, creating the file when
it is missing: never credentials or real data.

For package installation, application integration, or exposing an existing POM,
read [Onboarding](references/onboarding.md).

The `ayme` command runs the project's Page Objects beside the browser
automation you drive the browser with: Playwright CLI, Playwright MCP or
agent-browser. To start it and connect it to the same browser as your
automation, or when a command answers that no Session is open, read
[Browser automation tools](references/browser-automation-tools.md). When the
project is not set up for the command yet, or a Session does not start,
read [Browser setup](references/browser-setup.md).

While a Session is open, run `ayme page-objects` on each new screen,
starting with the first one, before you take a snapshot: a Page Object Tool
does in one call what several clicks and keystrokes would. Call one when it
does the next step, and take a snapshot only when none does. When you use
the Page Object Tools, or a command answers that a tool is unavailable, read
[Page tools](references/page-tools.md).

For designing or restructuring Page Object Models, read
[Page object design](references/page-object-design.md) and
[Page Object Models](references/ayme-page-objects.md). Where they conflict with
the project's conventions, raise the conflict with the user.

For mapping a user flow into a POM against the running app, read
[Live mapping](references/live-mapping.md). To record a flow the user drives
and turn it into page objects and a Playwright test, use the `ayme-capture`
skill, which [Coding agent skills](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/coding-agent-skill.md#ayme-capture) says how to install.

For registering Page Objects, placing or configuring the runtime owner, or
checking which tools are live, read
[Runtime integration](references/runtime-integration.md).

When debugging needs state the page does not show, such as unsaved edits,
component state or server data, or to add a Peek, read
[Peeks](references/peeks.md) before inferring that state from the page or the
source.

Follow the consumer project's existing POM conventions. The
[ayme documentation](https://github.com/ayme-labs/ayme/blob/main/docs/guide/README.md) owns the APIs and the framework wiring;
read the page for the project's framework before editing that integration.
