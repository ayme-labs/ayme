---
status: accepted
---

# The runtime session is the public browser interface; `/internal` serves ayme's own packages

`@ayme-dev/webmcp` exposed its browser runtime only through `@ayme-dev/webmcp/internal`. A consumer that is not a Vue or React application, such as a prebuilt script on a page ayme does not own, had to import from that entry and, to run the Goal Loop, imitate a WebMCP driver, because `pursue_goal` existed only as a published tool. No document said who may import `/internal`, and example applications did.

## Considered options

- Keep `/internal` as the runtime's entry and document it as supported. Its name says the opposite, and its contents mix the runtime with the compiler contract, the inspector's read model and the publication machinery.
- Add a new public wrapper (`startAymeRuntime`) over the runtime session. A shallow module in front of a deep one; the framework packages would still use the session underneath.
- Make the runtime session itself public.

## Decision

`createRuntimeSession` and its types are exported from the package's public entry, with one options object: `{ page?, ignore?, refTools?, goalLoop? }`. `page` is a factory the session calls once, lazily, in the browser; `createPage(options)` is the public default factory. The session gains `pursueGoal(goal, { maxSteps })`, so the Goal Loop runs for any consumer without WebMCP publication or a driver.

The Vue and React packages are adapters over this public interface and import it from the public entry. Runtime and publication stay independent, as ADR-0016 decided: publication is the WebMCP adapter over the runtime, not the way to reach it.

`/internal` remains, and serves exactly three consumers of ayme's own: the framework packages (server page objects, page registrations), the code `unplugin-webmcp` generates into application bundles (`registerCompiledPom`), and the inspector (the registry read model, page-state capture, page instrumentation). No application imports it; the example applications observe published tool schemas instead of the registry.

## Consequences

- Any consumer starts the runtime, registers Ref Tools, configures the Goal Loop and runs it through one public module; the framework packages become visibly thin.
- The registry read model is not public yet. It becomes a public interface when a second adapter reads it, such as a driver on the Playwright side; its shape is designed against that caller, not published as it stands today.
- Direction, not decided here: the runtime and the WebMCP adapter become separately named modules, `registerCompiledPom` a public function of the runtime, and `/internal` disappears.
