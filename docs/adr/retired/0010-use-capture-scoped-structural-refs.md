---
status: superseded by ADR-0012
---

# Use capture-scoped Structural Refs

A Structural Ref identifies one observed node within one Playwright capture. The distilled and full trees share real Playwright refs; an eligible omitted POM root may receive a synthetic `s_*` ref, which is not a Playwright action handle. We do not preserve identity across captures, keeping Playwright as the owner of real refs without promising false stability.
