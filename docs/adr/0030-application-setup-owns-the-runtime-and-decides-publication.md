---
status: accepted
supersedes: ADR-0016
---

# Application setup owns the runtime and decides publication

ADR-0016 gave the runtime one explicit owner at the application root and
made WebMCP publication a build policy. The owner model stands. The build
policy does not: whether tools are published is an application decision,
and splitting it between build configuration and application setup gave
one concern two owners.

This decision supersedes ADR-0016.

## Decision

Keep one explicit runtime owner per document. Root setup owns
initialization and cleanup; Page Object integration owns only the
registration of one Page Object. Reject a second owner while the first is
active and allow a new one after disposal. No reference counting, no
implicit startup on first registration, and no startup injected by the
build integration.

Runtime setup decides whether WebMCP publication is on. It is off unless
setup enables it. The build integration compiles Page Objects and has no
publication setting.

The runtime works independently of publication: Page Objects, local
page-state access and the Goal Loop work when publication is off or no
driver is available. When on, publication waits a bounded time for a
driver and supports an explicit retry. It mirrors the registry's active
tool set and adds no observer of its own (ADR-0009).

Turning publication off does not remove Ayme or Page Object code from
browser output. Complete removal from production builds remains a
separate decision, to be resolved before production adoption is
recommended.

## Consequences

One place starts Ayme, stops it and decides publication, with or without
a framework integration.

Publication can no longer be compiled out through a build setting.
Removal from production builds is the mechanism for that.
