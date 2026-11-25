---
status: accepted
---

# Capture only the top-level document

The Structural Page State covers the top-level document only. An iframe element may appear, but its child document and the Page Object Roots inside it do not. This avoids treating frame-local refs as one namespace before frame composition rules exist.
