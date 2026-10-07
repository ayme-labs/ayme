---
status: accepted
---

# Peek Tools reach coding agents only, and only while the app runs in development

A Peek exposes application state that the page does not show, such as unsaved edits or server data, so it is a development aid, not part of the app's agent surface. Peek Tools are offered through the Agent Connection and shown in the Inspector, never published through WebMCP and never offered by the Goal Loop. A Peek is live only while its runtime session has the Agent Connection or the Inspector on, which applications already turn on only in development; otherwise peeking does nothing. We considered publishing Peek Tools like every other tool and leaving production to the application's WebMCP setting (ADR-0030), and rejected it: one setting would then decide both what an in-browser agent may do and what internal state it may read. Peek calls still ship in production bundles until a build step removes them; that removal is planned separately.
