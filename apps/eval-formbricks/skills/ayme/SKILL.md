---
name: ayme
description: Drive the open web page through Ayme's MCP server, with the page's Page Object Tools first, Browser Tools when needed, and goal when it is listed.
---

# Driving the page through Ayme

The `ayme` MCP server is already connected to the open tab. Its tools act on that page, and they are already in your tool list, so `ayme_list_tools` is not needed.

## Prefer the Page Object Tools

Each screen publishes actions named after its page objects, such as `SomePage_doAction`. Use them first: one call does what several clicks and keystrokes would. Use Browser Tools for what no page object covers.

## Read each answer instead of taking a snapshot

Every action answers with `page_changed`, `settled` and `changes`, a diff of the page after the call, element refs included.

- If `changes` shows the effect you expected, move on.
- `page_changed: false` means the call changed nothing. Calling it again won't help; try another way.
- Take a `snapshot` only when an answer is empty or inconclusive about whether the call worked.

## Hand the goal over when `goal` is listed

When `goal` is among the tools, hand it the task, and pass every value the task names in `values`, each labelled in plain words: `{"<what the value is>": "<value>"}`. The Goal Loop takes free text only from `values`; without them it hands back with `needs_value`. If it hands back, finish with the tool it names.
