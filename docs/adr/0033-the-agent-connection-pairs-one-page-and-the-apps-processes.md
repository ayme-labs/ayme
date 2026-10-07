---
status: accepted
supersedes: ADR-0032
---

# Each coding agent's Ayme MCP server pairs with one page and with the app's own processes, and a local process pairs without a token

ADR-0032 gave each coding agent its own Ayme MCP server, paired with one tab, with two fixed fallback tools that keep every page tool reachable. That stands. What changes is who may pair: Peeks read state that lives on the server as well as in the browser, so the app's own Node processes, such as its dev server or an Express backend, now pair with the same server beside the page. They never replace the page or each other, and each call goes to the connection that offers the tool. A process finds the server the way a page does, pairing only when exactly one server answers, and pairs without a token when its connection sends no `Origin`. Browsers always send `Origin`, and the server listens on loopback only, so such a connection can only come from a local program, which can already act as the developer. We considered a pairing file the server writes and the process reads, and rejected it: it leaves files behind and needs a location every process agrees on, for no gain against a local program. The cost is that any local process can offer tools to the agent, and that the server now routes calls across several connections.

This decision supersedes ADR-0032.
