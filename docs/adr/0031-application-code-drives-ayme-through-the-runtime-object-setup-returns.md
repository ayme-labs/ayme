---
status: accepted
supersedes: ADR-0025
---

# Application code drives Ayme through the runtime object setup returns

ADR-0025 made the runtime session the public browser interface and kept
`/internal` for Ayme's own packages. It recorded the session's names and
options, which have since changed. This decision keeps what future work
must respect and leaves names and signatures to the package README.

This decision supersedes ADR-0025.

## Decision

The runtime object that application setup creates, with or without a
framework integration, is the one public interface application code uses
in the browser. Framework integrations are thin adapters over it and add
no operations of their own.

Every registered tool can be reached through that object by name, whether
or not WebMCP publication is on. A programmatic call runs the registered
tool through the same execution path as an agent's call and a Goal Loop
step, so there is one action implementation. It fails by throwing Ayme's
errors; only publication turns errors into tool results. It acts as a
caller of its own, so it does not move the calling agent's Change Record.

`/internal` is transitional. It holds what has no public interface yet,
and Ayme's own packages move off it as public interfaces appear.

## Considered options

- One typed method per tool: discoverable, but it reaches neither Custom
  Tools nor Page Object Tools and grows with the tool set.
- Returning tool-failure results to application code: it makes
  applications handle an MCP result shape.
- Sharing the agent's caller: an application's action would vanish from a
  connected agent's Change Record.

## Consequences

The interface's names and signatures live in the package README. Research
PR #329 holds the comparison.
