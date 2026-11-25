---
status: accepted
---

# Use structural POMs and explicit WebMCP exposure

Consumers should be able to reuse ordinary TypeScript POMs with Playwright and WebMCP without adopting ayme base classes or duplicating their method schemas.

## Considered options

- OC1: Require ayme base classes or custom POM declarations.
- OC2: Infer the production contract through runtime reflection.
- OC3: Use the structural TypeScript contract for development-time discovery and decorators for production WebMCP exposure.

## Decision

Treat ordinary TypeScript classes as POMs without requiring ayme base classes. A class is a Page Object Model when it, or an ancestor, carries ayme's mark.

Use TypeScript visibility and static types to derive the development-time POM contract.

Expose as production WebMCP tools only Page Object Actions whose declaration is explicitly marked, including a marked method a class inherits; an unmarked method is never exposed, whatever its class. A class's recognition as a Page Object Model may be inherited. Derive their schemas from their TypeScript signatures. A type the compiler cannot represent fails the build; there is no override for it.

## Consequences

Consumers can retain their existing POM architecture.

Public POM members do not automatically become production tools.

Unsupported or ambiguous types produce build diagnostics instead of weak runtime schemas.
