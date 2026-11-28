---
status: accepted
supersedes: ADR-0056
---

# A Session's Inspector admits its window by origin, and the Inspector in an Agent App's chat by the Session's token

## Why

A Session's process serves its Inspector on a loopback port. Over that port's socket, the Inspector reads the Session's Tabs and runs their Page Object Tools. The `ayme` commands reach the same Session through a local socket that only its user can open, but a loopback port is open to every process and every user of the machine, and to every web page the person's browser shows.

Admission has to keep web pages out: a site the person visits could otherwise read their Session and run its tools. A browser marks each request with the origin of the page that sent it, and no page can send another page's origin. Other users of the machine are not what admission guards against, since they can already connect to the browser's DevTools port, which admits anyone and can do more than the Inspector.

The Inspector an Agent App shows in its chat cannot be admitted by its origin: depending on the app, its frame sends `null`, an origin random per install, or one that changes per thread.

## Decision

- The Inspector's socket admits a request whose host is the address the Session's process printed and whose origin is that same address: a window at the address `ayme inspect` prints. The window brings no secret, so the address opens any number of windows, and a reloaded one, until the Session ends.
- The host has to match as well as the origin because a page can point a name of its own at the port. Its requests then carry that name as both host and origin, and neither is the printed address.
- Each Session makes one unguessable token, and only the commands' socket hands it out. The Inspector's socket admits a client that brings it, from any origin. Only the Inspector an Agent App shows in its chat needs it. The page `ayme mcp` gives the Agent App holds the token beside the Inspector's script, since an Agent App loads no script from elsewhere.
- The socket refuses a request that has neither, including one that sends no origin.
- The window's page and script are public: they hold no credential, and no other origin may frame the page.
- The Session makes the Inspector the Caller of a Run started over the Inspector's socket, whatever the client names.
- The token ends with the Session.

## Considered and rejected

- A secret for the window, tried and removed. First the window's address held the token; then it held a one-use code, valid for minutes, that the window traded for the token. Both guarded against other users of the machine, who have the DevTools port anyway. They cost an address that opened one window, a window that could not reload where the browser kept no storage for the tab, and an exchange to keep working. Do not bring one back while the DevTools port stays open to those users.
- Admitting the Inspector in an Agent App's chat by an allow-list of origins. Any sandboxed frame sends `null`, and the app's other origins change per install or per thread.
- Carrying the Inspector's data through the Agent App's tool calls. Depending on the app, the page's tools then show to the model, a call held open is cancelled, or each call takes seconds.

## Cost

- A local process that is not a browser sends any origin it likes, so any process of any user on the machine can connect, the agent's own included. It can then read the Session's Tabs and run their Page Object Tools, as it can already drive the browser through the DevTools port.
- Whoever holds the token can connect from a page of any origin until the Session ends: whoever can read the page an Agent App shows, and its model too when the Agent App lets the model read MCP resources or records them in a trace.
- A window or a page in a chat from a Session that ended no longer connects, since a new Session has a new port and token.
