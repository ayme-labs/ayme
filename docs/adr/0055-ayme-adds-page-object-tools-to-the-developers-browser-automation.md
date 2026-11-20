---
status: accepted
amends: ADR-0007, ADR-0023, ADR-0033
---

# Ayme adds Page Object Tools to the developer's browser automation, and each channel offers only that by default

## Why

Developers who drive a browser with a coding agent already use Playwright MCP, Playwright CLI or agent-browser. Ayme offered its own Browser Tools, `snapshot`, `goal` and Custom Tools beside its Page Object Tools, in `ayme mcp` and in WebMCP. An agent that had both saw two ways to click and two ways to read the page, and nothing said which to use. On the Formbricks eval, Ayme made each of the three browser automations cheaper or faster only with a short tool list. With the long one it often did not.

## Decision

Ayme adds to the browser automation a developer already uses. It does not replace it.

- WebMCP publishes a page's Page Object Tools and `page_objects`, and nothing else. No option brings the rest back there.
- `ayme mcp` lists the page's Page Object Tools, `page_objects` and Peek Tools, the App Processes' tools, and its own tools (`ayme_connect`, `ayme_inspect`, `ayme_list_tools`, `ayme_call`).
- `ayme mcp --browser-tools` also lists Ayme's own browser driving: Browser Tools, `snapshot`, `goal` and Custom Tools. It is for a developer whose only browser automation is Ayme. Custom Tools go with them because a Custom Tool names its element by a Structural Ref, which only Ayme's `snapshot` gives.
- `ayme mcp --webmcp` makes the page `ayme mcp` serves Page Objects to publish them through WebMCP too. It is a plain, supported option, off by default.
- The server decides what it lists. The page reports every tool with its group, so the same page code works in both modes, whether it ships Ayme and pairs through `ayme_connect` or loads served Page Objects.
- The server's own tools stay in both modes. A page that ships Ayme pairs through `ayme_connect`, and an agent whose client never refreshes its tool list reaches the page through `ayme_list_tools` and `ayme_call`.

## Considered and rejected

- Keep the long list and explain in descriptions when to use which tool. Agents follow descriptions unevenly, and the long list itself cost tokens and turns on the eval.
- An option that strips the list to Page Object Tools alone, the prototype's `--only-page-object-tools`. It dropped the server's own tools, so a page that ships Ayme could no longer pair, and it worked only for served Page Objects.
- Let the page decide what it hands the server. The developer's app code would change with the agent's setup, and a page that ships Ayme would need a new option.
- Make `--webmcp` experimental. It is the start command for Playwright CLI, and an option a developer may read as temporary is one they avoid.

## Amends

- ADR-0007: explicit exposure of decorated actions stands. WebMCP now publishes those Page Object Tools and `page_objects` only, not every tool of the session.
- ADR-0023: a Ref Tool, Browser Tool or Custom Tool, is still one registration for agents and the Goal Loop. It reaches an agent through `ayme mcp --browser-tools` only, no longer through WebMCP.
- ADR-0033: the two fallback tools keep every tool the server lists reachable, not every tool of the page.

ADR-0034 needs no change: Peek Tools stay offered through the Agent Connection in both modes, and WebMCP still never publishes them.

## Cost

A developer who used Ayme as their only browser automation must add `--browser-tools` to the start command; the changelog says so in one line. A page from before the page client sent each tool's group gets every tool listed, as before, until its `@ayme-dev/mcp` is updated.
