---
status: accepted
amends: ADR-0033
---

# ayme adds Page Object Tools to the developer's browser automation, and `ayme mcp` offers only that

## Why

Developers who drive a browser with a coding agent already use Playwright MCP, Playwright CLI or agent-browser. `ayme mcp` offered ayme's own Browser Tools, `snapshot`, `goal` and Custom Tools beside its Page Object Tools. An agent that had both saw two ways to click and two ways to read the page, and nothing said which to use. On the Formbricks eval, ayme made each of the three browser automations cheaper or faster only with a short tool list. With the long one it often did not.

## Decision

ayme adds to the browser automation a developer already uses. It does not replace it.

- `ayme mcp` is how a coding agent outside the browser reaches the page, whatever drives the browser. It lists the page's Page Object Tools, `page_objects` and Peek Tools, the App Processes' tools, and its own tools: to pair with a page, to open the Inspector, and to list and call any tool it lists.
- `ayme mcp` lists none of ayme's own browser driving: not the Browser Tools, `snapshot`, `goal` or Custom Tools. A coding agent drives the browser with its own browser automation; one without any adds one. Custom Tools go with the Browser Tools because a Custom Tool names its element by a Structural Ref, which only ayme's `snapshot` gives.
- The server decides what it lists. The page reports every tool with its group, so the page code is the same whichever agent reaches it, whether the page ships ayme and pairs through the server's pairing tool or loads served Page Objects.
- The server's own tools stay. A page that ships ayme pairs through the server's pairing tool, and an agent whose client never refreshes its tool list reaches the page through the server's tools that list and call tools.
- WebMCP publication is for an agent that runs in the page, which has no browser automation of its own. It publishes the session's tools, `page_objects` among them, and is experimental. A page that loads served Page Objects publishes nothing through WebMCP.

## Considered and rejected

- Keep the long list and explain in descriptions when to use which tool. Agents follow descriptions unevenly, and the long list itself cost tokens and turns on the eval.
- Keep ayme's own browser driving behind an option of `ayme mcp`, for a developer whose only browser automation is ayme. Each coding agent the eval ran already has browser automation, or adds one with a line of setup, and the option kept a second listing, its tests and a second way to drive the page in every guide.
- An option that strips the list to Page Object Tools alone. It drops the server's own tools, so a page that ships ayme could no longer pair, and it works only for served Page Objects.
- Let the page decide what it hands the server. The developer's app code would change with the agent's setup, and a page that ships ayme would need a new option.
- Hand the Page Object Tools to the browser automation through the page's WebMCP tools, which Playwright CLI, Playwright MCP and agent-browser can read. Each needs a Chrome started with a WebMCP flag and reads the page's tools in its own way, and none of them gains anything `ayme mcp` beside it does not give.
- Publish only Page Object Tools and `page_objects` through WebMCP too. An agent in the page has nothing else to act with.

## Amends

- ADR-0033: the two fallback tools keep every tool the server lists reachable, not every tool of the page.

ADR-0034 needs no change: Peek Tools stay offered through the Agent Connection, and WebMCP still never publishes them.

## Cost

A developer who used ayme as their only browser automation must add another, such as Playwright MCP, and a coding agent can no longer run the Goal Loop through `goal`; the changelog says so in one line.
