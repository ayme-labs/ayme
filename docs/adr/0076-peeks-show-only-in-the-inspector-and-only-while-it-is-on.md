---
status: accepted
supersedes: ADR-0034
---

# Peeks show only in the Inspector, and only while it is on

A Peek exposes application state that the page does not show, such as unsaved edits or a store, so it is a development aid, not part of the app's agent surface. Its Peek Tool is listed and run in the Inspector, and no agent reaches it: WebMCP publication never publishes it, the Goal Loop never offers it, and a Session offers Page Object Tools only. The Agent Connection, which carried Peek Tools to coding agents, is gone (ADR-0074). A Peek is live only while its session has the Inspector on, which applications turn on only in development; otherwise peeking does nothing, and in Node it always does.

We considered publishing Peek Tools like every other tool and leaving production to the application's WebMCP setting (ADR-0030), and rejected it: one setting would then decide both what an in-browser agent may do and what internal state it may read. Peek Tools through WebMCP in development only is an open question of its own. Peek calls still ship in production bundles until a build step removes them; that removal is planned separately.
