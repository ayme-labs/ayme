---
status: accepted
supersedes: ADR-0034
---

# Peeks show only in the Inspector, and only while it is on

A Peek exposes application state that the page does not show, such as unsaved edits or a store, so it is a development aid, not part of the app's agent surface.

A Peek's Peek Tool is listed and run in the Inspector, and no agent reaches it: WebMCP publication never publishes it, the Goal Loop never offers it, and a Session offers Page Object Tools only (ADR-0074). A Peek is live only while the browser runtime's configuration turns the Inspector on, whatever the build's mode and whether or not the panel is open. Otherwise, and always in Node, adding a Peek does nothing. While it is live, application code can still read it through the runtime's own call of its tool.

We rejected publishing Peek Tools like every other tool and leaving production to the application's WebMCP setting (ADR-0030): one setting would then decide both what an in-browser agent may do and what internal state it may read. Whether Peeks reach an agent through WebMCP in development is open in [#1505 "Peeks reach a coding agent through WebMCP in development"](https://github.com/ayme-labs/ayme/issues/1505).

The cost: nothing outside the page reads a Peek any more, since the Agent Connection that carried Peek Tools to coding agents is gone (ADR-0074). And an app that turns the Inspector on in a build makes its Peeks live in that build.
