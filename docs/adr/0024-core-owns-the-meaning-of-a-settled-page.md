---
status: accepted
---

# Core owns the meaning of a Settled Page; the activity signal comes from outside

`waitForSettled` lives in the structural observation core. It owns the quiet window, the deadline and the `stable` result. The execution context supplies only a `PageActivitySource`, a raw "something happened" signal. The wait subscribes when called, unsubscribes when it resolves, and takes no capture; the caller captures once afterwards.

Polling captures on a timer was measured and ruled out in the browser: one capture costs about 6 ms plus 30 µs per DOM element on the main thread, so polling a real page keeps the main thread busy. The browser supplies DOM mutations plus transition, animation, scroll and resize events; a Node Playwright context can supply its own signal.

Rejected: an adapter that provides the whole wait. Every context would define the quiet window and `stable` for itself, and core would become a pass-through. Known limit: work that starts after the quiet window has ended is not seen.
