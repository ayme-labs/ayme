---
status: accepted
---

# The recorder runs on stock Playwright and uses its private parts only under test

The first Ayme recorder ran on a fork of Playwright itself (not Playwright Lite, which ADR-0021 covers), bundled into the CLI. The fork gave the recorder its own page structure capture, refs stamped into the trace, and a slot for its toolbar. It also tied every user to the fork's Playwright version, and had to be rebased on every Playwright release.

The recorder now uses the Playwright the project already has installed. Nothing of Playwright is bundled or patched. Interactions come from Playwright's own recorder, page structure from its public snapshot, and the trace from its public tracing.

Part of what the recorder needs is not public API: starting Playwright's recorder without its window, reading and switching its mode, and reading which element a ref belongs to. The recorder may use a private part of Playwright when three things hold: it is reachable without changing Playwright, all use of it sits behind one adapter, and an integration test exercises it against every supported Playwright version. A new Playwright version joins the supported range only once those tests pass on it.

Outside the supported range the recorder warns and still records if it finds Playwright's recorder, and otherwise stops and names the range.

Considered and rejected: keeping the fork, for its upkeep on every release and the version it forces on users; and capturing interactions ourselves, because Playwright already does it and keeps it current. Vendoring Playwright's generated recorder script was not needed; it remains the fallback if the private recorder API disappears.

What this gives up: the page structure is Playwright's, so an element Playwright leaves out of its snapshot is absent from the recording, and refs are not stamped into the trace.
