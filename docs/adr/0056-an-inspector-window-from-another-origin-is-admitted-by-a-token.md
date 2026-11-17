---
status: accepted
---

# An Inspector window from another origin is admitted by a token the server gives it

`ayme mcp` admits a window to the Inspector's socket in one of two ways. A window with the server's own origin, or a local process that sends no `Origin`, is admitted as before (ADR-0049). A window with any other origin is admitted when its socket URL carries the Inspector's token. Either way, the request must name the loopback server as its `Host`. The token exists for the Agent App that shows the Inspector in its chat as an MCP App: `ayme mcp` writes the token into the page it gives the Agent App over MCP, so the page can connect from whatever origin the Agent App runs it under. `ayme mcp` creates the token when it starts and logs every window it admits by it. The token opens the Inspector's socket only. A page or an App Process pairs with the pairing token (ADR-0033), which is a different value.

An origin check cannot do this job. We measured the origin three Agent Apps give the page: T3 Code sends `null`, Cursor a `vscode-webview://` origin with a random id, and Claude Desktop a subdomain of `claudemcpcontent.com`. Any frame sandboxed without `allow-same-origin` sends `null`, and the other two change per install or per thread, so an allow-list would admit other pages too or miss the real windows, and each new Agent App would need a release. We also rejected carrying the Inspector's data through the Agent App's own tool calls, which needs no socket: Cursor shows the model the tools meant only for the page, Claude Desktop cancels a call held for 60 seconds, and a call through T3 Code takes 1 to 14 seconds.

The cost is a secret that sits in a page. The Agent App holds the token, so does any script running in the frame, and so does the model where an Agent App shows it the page's source. Whoever holds it can read what the Inspector reads of the paired page and run its tools, which is what the browser-window Inspector can do. The token ends with the server process: a page left in a chat after `ayme mcp` restarts is refused, and the agent has to call `ayme_inspect` again.
