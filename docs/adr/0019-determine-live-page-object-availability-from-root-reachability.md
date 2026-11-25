---
status: accepted
---

# Determine live Page Object availability from root reachability

A live Page Object is available when its root represents UI that a user can currently reach through ordinary interaction. Normal scrolling may make a root reachable; a hidden, collapsed, off-canvas or covered root is unavailable. DOM presence or Playwright visibility alone is insufficient.

Compiled Page Object Model definitions stay independent of live availability.

Observing availability must not click, focus or scroll the user's page. Availability is a Page Object-level gate, not a guarantee that every action will succeed.

A Page Object without a root keeps registration-driven availability: it is available while it is present.
