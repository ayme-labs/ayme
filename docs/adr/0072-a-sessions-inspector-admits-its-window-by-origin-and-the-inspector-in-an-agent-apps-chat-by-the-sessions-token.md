---
status: accepted
supersedes: ADR-0056
---

# A Session's Inspector admits its window by origin, and the Inspector in an Agent App's chat by the Session's token

## Why

A Session's process serves its Inspector on a loopback port. Over that port's socket, the Inspector reads the Session's Tabs and runs their Page Object Tools. The `ayme` commands reach the same Session through a local socket that only its user can open, but a loopback port is open to every process and every user of the machine, and a page in the person's browser can send requests to it.

Admission has to keep web pages out: a site the person visits could otherwise read their Session and run its tools. A browser marks the request that opens a socket with the origin of the page that sent it, and no page can send another page's origin.

Admission does not keep other users of the machine out. A browser that `ayme open` started already gives them more than the Inspector does: its DevTools port admits anyone. A browser joined with `ayme attach` can sit at an address that asks for a secret, and there the Inspector's port gives them access they did not have. A secret never kept the processes of the Session's own user out, since they can ask the commands' socket for it.

The Inspector an Agent App shows in its chat cannot be admitted by its origin: depending on the app, its frame sends `null`, an origin random per install, or one that changes per thread.

## Decision

- The Session's process serves the Inspector's window at `http://127.0.0.1:<port>/inspector`, the address `ayme inspect` prints, and its socket at `/inspector/ws` on the same port. Every request has to name `127.0.0.1:<port>` as its host, because a page can point a name of its own at the port, and its requests then carry that name.
- The socket admits a request whose origin is the window's own, `http://127.0.0.1:<port>`. The window brings no secret, so the address opens any number of windows, and a reloaded one, until the Session ends.
- Each Session makes one unguessable token and hands it out only over the commands' socket. The Inspector's socket admits a request that brings it, whatever its origin. Only the Inspector an Agent App shows in its chat needs it: `ayme mcp` gives the Agent App one page that holds the Inspector's script and the socket's address with the token.
- The socket refuses a request that brings neither, including one that sends no origin.
- The window's page and script are public: they hold no credential, and no other origin may frame the page.
- The Session makes the Inspector the Caller of a Run started over the Inspector's socket, whatever the client names.
- The token ends with the Session.

## Considered and rejected

- A secret for the window, tried and removed. First the window's address held the token; then it held a one-use code, valid for minutes, that the window traded for the token. Both guarded only against other users of the machine. They cost an address that opened one window, a window that could not reload where the browser kept no storage for the tab, and an exchange to keep working. Do not bring one back to guard against those users.
- A secret only for a browser joined with `ayme attach`, or no window for it. Two ways to admit a window would have to keep working, and every joined browser would pay the costs above.
- Admitting the Inspector in an Agent App's chat by an allow-list of origins. A frame with an opaque origin sends `null`, as every other such frame does, and the app's other origins change per install or per thread.
- Carrying the Inspector's data through the Agent App's tool calls. Depending on the app, the page's tools then show to the model, a call held open is cancelled, or each call takes seconds.

## Cost

- A local process that is not a browser sends any origin it likes, so any process of any user on the machine can connect, the agent's own included. It can then read the Session's Tabs and run their Page Object Tools, which run the project's code in the Session's process. This holds also when the browser was joined at an address that asks for a secret: on a machine with other users, the Session opens that browser to them.
- Whoever holds the token can connect from a page of any origin until the Session ends: whoever can read the page an Agent App shows, and its model too when the Agent App lets the model read MCP resources or records them in a trace.
- A window or a page in a chat from a Session that ended no longer connects to it. When a later Session gets the same port, a window left open from the earlier one shows the later Session; a page in a chat does not, since its token ended.
