---
status: accepted
---

# Core owns the meaning of a Settled Page; the activity signal comes from outside

The wait for a Settled Page lives in the structural observation core. It owns the quiet window, the deadline and whether the page became stable. The execution context supplies only a raw "something happened" signal. The wait subscribes when called, unsubscribes when it resolves, and takes no capture; the caller captures once afterwards.

Polling captures on a timer was measured and ruled out in the browser: a capture runs on the main thread and its cost grows with the page's size, so polling a real page keeps the main thread busy. The browser supplies DOM mutations plus transition, animation, scroll and resize events; a Node Playwright context can supply its own signal.

Rejected: an adapter that provides the whole wait. Every context would define the quiet window and what stable means for itself, and core would become a pass-through. Known limit: work that starts after the quiet window has ended is not seen.
