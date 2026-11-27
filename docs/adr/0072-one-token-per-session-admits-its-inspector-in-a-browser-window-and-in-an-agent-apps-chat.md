---
status: accepted
supersedes: ADR-0056
---

# One token per Session admits its Inspector, in a browser window and in an Agent App's chat

## Why

A Session's process serves its Inspector on a loopback port, and over that port's socket the Inspector reads the Session's Tab and runs its Page Object Tools. The commands reach the same Session through a local socket that only its user can open, but a loopback port is open to every process and every user of the machine. A check of the request's origin stops only a browser page: any other client sends whatever origin it likes, or none. And the Inspector an Agent App shows in its chat comes from another origin anyway: depending on the app, its frame sends `null`, an origin random per install, or one that changes per thread.

## Decision

- Each Session makes one unguessable token, and only the commands' socket hands it out. The Inspector's socket admits a client that brings it, from any origin, and no other: one admission serves the window and the view in an Agent App's chat.
- The page an Agent App shows holds the token beside the Inspector's script, since an Agent App loads no script from elsewhere.
- `ayme inspect` opens the window with a one-use code instead of the token. The commands' socket makes one code per opening; the Inspector's socket takes it once, and only for a short time; the Session then tells the window it admitted the token, to connect again with.
- The window's page and script are public: they hold no credential, and no other origin may frame the page.
- A Run started over the Inspector's socket has the Inspector as its Caller. The Session sets it, whatever the client names.
- The token ends with the Session.

## Considered and rejected

- Admitting by origin, or by an allow-list of origins: a client outside a browser sends any origin or none, any sandboxed frame sends `null`, and an Agent App's other origins change per install or per thread.
- A token for the chat alone, beside an origin check for the window: two admissions to keep, and the origin check lets in any local process that sends no origin.
- The token in the address `ayme inspect` opens: the address goes to the program that opens a browser as a process argument, which other users of the machine can read for as long as that program runs, and the command prints it, so a terminal's transcript keeps a key that works until the Session ends.
- Carrying the Inspector's data through the Agent App's tool calls: depending on the app, the page's tools then show to the model, a call held open is cancelled, or each call takes seconds.

## Cost

- Whoever holds the token can read the Session's Tab and run its Page Object Tools until the Session ends, as the window can: whoever can read the page an Agent App shows, or the window's tab storage.
- An Agent App that lets its model read MCP resources, or records them in a trace, gives the model the token. A model that can also open local network connections can then use the Inspector, and its Runs are listed as the Inspector's.
- The one-use code is in the process arguments of the program that opens the browser, and in what `ayme inspect` prints. A process that reads it there and connects before the browser does gets the token, and the person's window then fails to connect, which they see. Once the code is used or runs out, neither holds anything that works.
- A page left in a chat after its Session ended no longer connects: the agent shows the Inspector again for the new Session.
- A tab that has neither the code nor the token connects nowhere, and neither does a reloaded window whose browser keeps no storage for the tab: `ayme inspect` opens the window again.
