---
name: ayme
description: Set up ayme in a consumer project, expose existing Page Object Actions, design Page Object Models for ayme, and run the project's Page Object Tools with the `ayme` command beside Playwright CLI, Playwright MCP or agent-browser.
---

# ayme

Read `ayme/CONVENTIONS.md` first, when it exists. It holds what the user
settled for ayme and its skills in this repository, and it overrides this
skill's defaults. Read its opening part, which holds for every skill, and its
`ayme` section, and follow any line that points to another file. When the
user settles something for every later run, write it under `ayme`, creating
the file if it is missing. Never write credentials or real data there.

## Run the project's Page Object Tools

The `ayme` command runs the project's Page Objects in a Session: one running
ayme connected to the browser you drive with your browser automation, such
as Playwright CLI, Playwright MCP or agent-browser. Each marked action of a
Page Object is a Page Object Tool you can call.

- To start a Session, or when a command answers that no Session is open,
  read [Browser automation tools](references/browser-automation-tools.md).
- When the project is not set up for the command yet, or a Session does not
  start, read [Browser setup](references/browser-setup.md).
- While a Session is open, run `ayme page-objects` on each new screen,
  starting with the first, before you take a snapshot: a Page Object Tool
  does in one call what several clicks and keystrokes would. Call one when it
  does the next step, and take a snapshot only when none does. Before your
  first call, read [Page tools](references/page-tools.md).

## Write Page Object Models

Follow the project's existing Page Object Model (POM) conventions.

- To install ayme in the app, or to expose an action of an existing POM,
  read [Onboarding](references/onboarding.md).
- To design or restructure POMs, read
  [Page object design](references/page-object-design.md) and
  [Page Object Models](references/ayme-page-objects.md). Where they conflict
  with the project's conventions, raise the conflict with the user.
- To map a user flow into a POM against the running app, read
  [Live mapping](references/live-mapping.md). To record a flow the user
  drives instead, and turn it into page objects and a Playwright test, use
  the `ayme-capture` skill, which
  [Coding agent skills](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/coding-agent-skill.md#ayme-capture)
  says how to install.
- To register Page Objects in the app, place or configure the code that
  starts ayme there, or check which tools are live, read
  [Runtime integration](references/runtime-integration.md).

The
[ayme documentation](https://github.com/ayme-labs/ayme/blob/main/docs/guide/README.md)
owns the APIs and the framework wiring. Read the page for the project's
framework before you edit that integration.
