---
status: accepted
---

# Use structural POMs and explicit WebMCP exposure

Consumers should be able to reuse ordinary TypeScript POMs with Playwright and WebMCP without adopting Ayme base classes or duplicating their method schemas.

## Considered options

- OC1: Require Ayme base classes or custom POM declarations.
- OC2: Infer the production contract through runtime reflection.
- OC3: Use the structural TypeScript contract for development-time discovery and decorators for production WebMCP exposure.

## Decision

Treat ordinary TypeScript classes as POMs without requiring Ayme base classes.

Use TypeScript visibility and static types to derive the development-time POM contract.

Expose only explicitly decorated POM actions as production WebMCP tools. Derive their schemas from their TypeScript signatures. Require an explicit compatible override when the compiler cannot represent a type.

## Consequences

Consumers can retain their existing POM architecture.

Public POM members do not automatically become production tools.

Unsupported or ambiguous types produce build diagnostics instead of weak runtime schemas.

## Clarification (2026-09-24)

Explicit exposure concerns actions: every action stays decorated with `@WebMCP.tool`. Recognition of a Page Object class may be inherited: a class is a Page Object Model when it, or an ancestor, carries `@WebMCP` (#22).
