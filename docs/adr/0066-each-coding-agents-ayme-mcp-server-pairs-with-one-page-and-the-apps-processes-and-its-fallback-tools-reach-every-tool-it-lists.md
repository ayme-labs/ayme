---
status: accepted
supersedes: ADR-0033
---

# Each coding agent's ayme MCP server pairs with one page and with the app's own processes, and its fallback tools reach every tool it lists

## Why

The WebMCP local relay ran one server for a whole machine, and the first one started decided the settings for every agent after it, so several agents, worktrees and agent products on one machine conflicted. That is the normal way developers work with coding agents.

Peeks read state that lives on the app's server as well as in the browser, so the app's own Node processes need to offer tools to the same agent as the page.

Not every agent client follows changes to a server's tool list, so tools a page adds after the agent connected must stay reachable without it.

## Decision

- Each coding agent runs its own ayme MCP server. The server pairs with one page, through a link the agent asks for, and does not manage a browser.
- The app's own processes, such as its dev server or a backend, pair with the same server beside the page, as App Processes. They never replace the page or each other, and each call goes to the connection that offers the tool.
- A process that looks for the server finds it the way a page does, and pairs only when exactly one server answers.
- A process pairs without a token when its connection sends no `Origin`. Browsers always send one, and the server listens on loopback only, so such a connection can only come from a local program, which can already act as the developer.
- Two fixed tools of the server's own, one that lists tools and one that calls any of them by name, keep every tool the server lists reachable, whether or not the agent's client follows tool-list changes. Which of the page's tools the server lists is ADR-0055's.
- WebMCP publication stays for agents that run in the page.

## Considered and rejected

- Playwright MCP's WebMCP tools in place of a server of ayme's own. Attaching to the developer's own browser needs its extension, and agents would tend to use Playwright's generic tools over ayme's.
- A pairing file that the server writes and a process reads. It leaves files behind and needs a location every process agrees on, for no gain against a local program.

## Cost

There is one more package to publish, and ayme owns the channel between the server and the page. Any local process can offer tools to the agent, and the server routes calls across several connections.
