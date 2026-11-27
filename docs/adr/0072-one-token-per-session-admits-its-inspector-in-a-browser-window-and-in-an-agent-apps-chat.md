---
status: accepted
supersedes: ADR-0056
---

# One token per Session admits its Inspector, in a browser window and in an Agent App's chat

## Why

A Session's process serves its Inspector on a loopback port, and over that port's socket the Inspector reads the Session's Tab and runs its Page Object Tools. The commands reach the same Session through a local socket that only its user can open, but a loopback port is open to every process and every user of the machine. A check of the request's origin stops only a browser page: any other client sends whatever origin it likes, or none. And the Inspector an Agent App shows in its chat comes from another origin anyway: depending on the app, its frame sends `null`, an origin random per install, or one that changes per thread.

## Decision

- Each Session makes one unguessable token, and only the commands' socket hands it out: `ayme inspect` gets it for the window it opens, and `ayme mcp` for the page it gives the Agent App to show.
- The Inspector's socket admits a client that brings the token, from any origin, and no other. The token opens that socket only. The window's page and script are served to the Session's own origin alone, and no other origin may frame the page.
- The window gets the token in the address's fragment, which reaches no server, and takes it out of the address bar. The page an Agent App shows holds it beside the Inspector's script, since an Agent App loads no script from elsewhere.
- A Run started over the socket has the Inspector as its Caller, whatever the client names.
- The token ends with the Session.
- Until `@ayme-dev/mcp` is removed, its own `ayme mcp` keeps admitting a window from its server's own page by origin, and the Inspector in a chat by a token of that server's.

## Considered and rejected

- Admitting by origin, or by an allow-list of origins: a client outside a browser sends any origin or none, any sandboxed frame sends `null`, and an Agent App's other origins change per install or per thread.
- A token for the chat alone, beside an origin check for the window: two admissions to keep, and the origin check lets in any local process that sends no origin.
- Carrying the Inspector's data through the Agent App's tool calls: depending on the app, the page's tools then show to the model, a call held open is cancelled, or each call takes seconds.

## Cost

- Whoever can read the page an Agent App shows, or the address `ayme inspect` printed, holds the token, and with it can read the Session's Tab and run its Page Object Tools until the Session ends, as the window can.
- A page left in a chat after its Session ended no longer connects: the agent shows the Inspector again for the new Session.
- A window opened from the address without its fragment, such as from another tab, has no token and connects nowhere: `ayme inspect` opens it again.
