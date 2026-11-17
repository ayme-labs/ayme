---
status: accepted
---

# A token admits the Inspector that an Agent App shows in its chat

`ayme mcp` admits a browser window to the Inspector's socket by its origin, which is the server's own (ADR-0049). The Inspector an Agent App shows in its chat has another origin: T3 Code's frame sends `null`, Cursor's a random `vscode-webview://` origin, and Claude Desktop's a subdomain of `claudemcpcontent.com`. So `ayme mcp` writes a token into the page it gives the Agent App, and admits a window from another origin when it brings that token. The token opens the Inspector's socket only, never a pairing.

We rejected an allow-list of origins: any sandboxed frame can send `null`, and the other two change per install or per thread. We rejected carrying the Inspector's data through the Agent App's tool calls: Cursor shows the page's tools to the model, Claude Desktop cancels a call held for 60 seconds, and T3 Code takes up to 14 seconds per call.

The cost: whoever can read the page holds the token, and with it can read the paired page and run its tools, as the browser-window Inspector can. The token ends with the server, so a page left in a chat after a restart no longer connects.
