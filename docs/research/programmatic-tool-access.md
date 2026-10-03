# Programmatic access to registered browser tools

Research for #248 "Explore programmatic access to registered browser tools". Read against `main` at `ab1cf1a`, after the alpha stack (#297 to #304) merged. Not for merge: it informs a decision and stays open for review.

The issue names `webMcp.ts`. Since #303 the publication code is split: `webMcp.ts` holds the driver synchronisation and `runTool`; `publishedTools.ts` resolves the live tool set and holds the read model. Both are cited.

## Summary

1. **A generic executor already exists, and it already works without WebMCP.** `runTool(name, input)` runs any live tool (Browser Tools, Custom Tools, Page Object Tools, `snapshot`, `goal`) by its unprefixed name, through the same registration the publication and the Goal Loop use. Browser tests prove it returns exactly what an agent gets, with publication off (F1, F2). It is exported only from `/internal` and its one consumer is the Inspector.
2. **What is missing is not a mechanism but a public contract.** `runTool` was built to imitate an agent: errors come back as `isError` results, the call acts as the calling agent, and it reads module-global state rather than a session. Each of those is right for the Inspector and a choice to make for application code (§4).
3. **Recommendation: one executor member on the runtime session, reusing `runTool`'s resolution, with typed inputs for the Browser Tools.** Not a method per Browser Tool. The executor is the only option that reaches Custom Tools and Page Object Tools without a second action implementation, and its interface stays two members as the tool inventory grows. Typed methods win discoverability and argument typing; a typed input map recovers most of the typing (§3).
4. **Three owner decisions shape it** beyond the shape itself: the error contract (throw `AymeError` like `pursueGoal`, or return `isError` like `runTool`), whose Change Record cursor an application's call moves, and which tool groups the member covers. They are listed at the end without a recommendation where the evidence does not decide.

No experiment was run. The two uncertainties that could have needed one are settled by source and by existing tests: that `runTool` works with publication disabled and matches an agent's result (F2), and that an action moves its caller's cursor (F9).

## Facts

1. `runTool(name, input)` resolves the live tool set with `resolvePublishedTools()`, rejects with `RuntimeStateError('The tool "…" is not live.')` when no tool has that name, and runs the tool wrapped by `asAgentCall`: after the call it probes the Page Objects (`probeRegisteredPomMembers`), and any thrown error becomes an MCP `isError` result ([webMcp.ts:25-96](../../packages/ayme/src/webMcp.ts)). The live set is `snapshot`, the Browser Tools, the session's Custom Tools, the registered Page Object Tools and `goal` when a `goalLoop` is set, under their unprefixed names ([publishedTools.ts:41-84](../../packages/ayme/src/publishedTools.ts)). Authority: source.
2. `publishedTools.scenario.ts` runs each tool kind through `runTool` and compares with the same call made by an agent over WebMCP, both while publication is active and after it is switched off; failures and not-live tools are covered too ([publishedTools.scenario.ts:429-458, 600-695](../../packages/ayme/src/publishedTools.scenario.ts)). Line 362 runs a Page Object Action and a goal from the application with publication disabled. Authority: tests.
3. `runTool` and `listLiveTools` are exported from `/internal` only ([internal.ts](../../packages/ayme/src/internal.ts)). Outside tests their only caller is the Inspector, which runs a tool by name and turns an `isError` result back into a thrown `ToolFailure` ([inspector useRuns.ts:130-160](../../packages/inspector/src/adapter/useRuns.ts)). Authority: source.
4. Every recorded action goes through one function, `runAction`: it starts a Structural Action for a caller, runs the operation, waits for a Settled Page, and returns `ActionResult { page_changed, settled, changes?, result? }` ([actionSequence.ts](../../packages/ayme/src/actionSequence.ts)). Its callers are the single-element tool runner ([elementTools.ts:110-130](../../packages/ayme/src/elementTools.ts)), `fill_form` and `press_key` ([browserTools.ts:389-458](../../packages/ayme/src/browserTools.ts)) and the Page Object Tool runner ([registry.ts:1029-1048](../../packages/ayme/src/registry.ts)). Authority: source.
5. A single-element tool is registered once (`registerElementTool`) and carries `tool.execute` (as the calling agent) and `executeAs(input, caller)`; the runner validates the input against the tool's JSON schema, resolves `ref` or `target` through the identity ledger or a selector that must match exactly one element, and then calls `runAction` ([elementTools.ts:104-150, 188-260](../../packages/ayme/src/elementTools.ts)). The Goal Loop calls the same `executeAs` with caller `"goalLoop"` ([goalLoopQuestions.ts:218-234](../../packages/ayme/src/goalLoopQuestions.ts)). Page Object Tools have the same pair ([registry.ts:545-671](../../packages/ayme/src/registry.ts)). Authority: source.
6. The internal helper `ayme` has typed `click(ref)` and `fill(ref, value)` that call the registered `click` and `fill` with `{ target: ref }` and `{ target: ref, text }` as the agent ([ayme.ts](../../packages/ayme/src/ayme.ts), [browserTools.ts:310-318](../../packages/ayme/src/browserTools.ts)). They throw `AymeError`s rather than returning `isError`. #324 found no caller outside tests, and that their inputs diverge from the published `target`/`text` (F3 and §3 of [its note](https://github.com/ayme-labs/ayme/pull/324)). Authority: source.
7. `session.pursueGoal(goal, { maxSteps })` is the public precedent for a typed method on the session for one tool. It throws `RuntimeStateError` unless the session is started and has a `goalLoop`, runs the same loop as the `goal` tool, and resolves with the Handover ([runtime.ts:226-250](../../packages/ayme/src/runtime.ts)). Authority: source.
8. The README states "Only publication converts errors" and documents `AymeError` with `kind` `input`, `resolution` and `runtime` ([README.md:308-348](../../packages/ayme/README.md)). `runTool` converts errors although it is not publication (F1). Authority: source.
9. `Caller` is `"agent" | "goalLoop"`. Completing an action reconciles the acting caller's cursor against the Settled Page and moves that cursor ([interactionHistory.ts:20-28, 149-160](../../packages/ayme/src/interactionHistory.ts)). `runTool`, `tool.execute` and the `ayme` helper all act as `"agent"`. Authority: source.
10. The tool sets live in module-global state: Custom Tools in `globalThis.__aymeCustomToolStore`, Page Objects and the browser Page in the registry's module state. The session configures them on `start()` and clears them on stop ([elementTools.ts:283-303](../../packages/ayme/src/elementTools.ts), [registry.ts:100-115](../../packages/ayme/src/registry.ts), [runtime.ts:178-290](../../packages/ayme/src/runtime.ts)). `runTool` does not check for a started session; it fails only where a tool needs the browser Page (`requireAymeRuntimePage`). Authority: source.
11. `toolNamePrefix` applies at publication only; the registry and the Goal Loop use unprefixed names ([runtime.ts:56-63](../../packages/ayme/src/runtime.ts)). Authority: source.
12. Tool input schemas are `JsonSchema` values, not `as const` literals, so no TypeScript input type is derived from them today ([browserTools.ts:22-160](../../packages/ayme/src/browserTools.ts)). Authority: source.
13. `@ayme` and `@ayme.action` are markers that return nothing at runtime, and `construct` is `new PomClass(page)` ([decorators.ts:35-90](../../packages/ayme/src/decorators.ts), [registry.ts:170-179](../../packages/ayme/src/registry.ts)). Calling a Page Object Action as a plain method therefore records no action and returns no `ActionResult`; only the registered tool does. The same holds for `session.page`: its Playwright-style calls are not recorded. Authority: source.
14. A Custom Tool's `execute` receives `{ ref, element }`, a DOM `Element` ([elementTools.ts:24-36](../../packages/ayme/src/elementTools.ts)). The only Node-side route to a tool today is `/testing`'s `executePublishedTool(page, name, args)`, which goes through a recording WebMCP driver, i.e. through publication ([testing.ts:101-110](../../packages/ayme/src/testing.ts)). The Node recorder does not use the session (#324, F7). Authority: source.

## 1. Existing routes and what each lacks

| Route                   | Where        | Reaches                | Recorded, `ActionResult` | Errors             | Session-bound           |
| ----------------------- | ------------ | ---------------------- | ------------------------ | ------------------ | ----------------------- |
| `runTool(name, input)`  | `/internal`  | every live tool        | yes                      | `isError` result   | no, module state (F10)  |
| `ayme.click/fill(ref)`  | `/internal`  | `click`, `fill`        | yes                      | throws `AymeError` | no                      |
| `session.pursueGoal`    | public       | `goal`                 | yes, per step            | throws             | yes, requires `start()` |
| `session.page`          | public       | Playwright-style calls | no                       | throws             | yes                     |
| Page Object method call | the instance | that action            | no (F13)                 | throws             | no                      |

The public routes either cover one tool (`pursueGoal`) or bypass the action recording (`page`, plain method calls). The routes that reach the registered tools are internal.

## 2. The reusable execution path

Both options should sit on the existing chain and add nothing below it:

`resolvePublishedTools()` → the registered tool's `executeAs(input, caller)` → input validation and target resolution (`ref` through the identity ledger, `target` as a ref or a single-match selector) → `runAction` (Structural Action, settle, capture, Change Record) → `ActionResult`, then `probeRegisteredPomMembers()` so the live tool set (and the Inspector) reflect the change.

`runTool` already does this, except that it calls `tool.execute` (fixed caller `"agent"`) and wraps the result in `withErrorResult`. A session member would reuse the resolution and the probe, and choose the caller and the error contract itself. Page Object Tools and Custom Tools come along for free, because they are the same registered entries.

## 3. Options

**A. Typed methods on the session**, e.g. `session.click({ target })`, `session.fill({ target, text })`, one per Browser Tool, each calling the registered tool's `executeAs`.

**B. A generic executor on the session**, e.g. `session.tools.run(name, input)` and `session.tools.list()`, over the same resolution as `runTool`.

**C. B with typed Browser Tool inputs**: one `run` member whose signature is generic over a name→input map, so `run("fill", { target, text })` type-checks and unknown names fall back to `(string, Record<string, unknown>)` validated at runtime.

|                   | A. Typed methods                                                   | B. Executor                                            | C. Executor, typed inputs                                        |
| ----------------- | ------------------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------- |
| Discoverability   | Best: autocompletion lists every action                            | `list()` at runtime; names must be known or read       | Built-in names autocomplete; custom and Page Object names do not |
| Argument typing   | Full, per method                                                   | None at compile time; schema-validated at runtime (F5) | Full for Browser Tools; runtime-validated for the rest           |
| Built-in tools    | All, one method each                                               | All                                                    | All                                                              |
| Custom Tools      | Not reachable without a by-name escape hatch, i.e. B               | Yes, by name                                           | Yes, by name                                                     |
| Page Object Tools | Not reachable (plain method calls are unrecorded, F13)             | Yes, by name, with `ActionResult`                      | Yes, by name                                                     |
| Errors            | Free to choose                                                     | Free to choose                                         | Free to choose                                                   |
| Interface size    | 9 members for today's Browser Tools, growing with #242's inventory | 2 members                                              | 2 members plus an exported type                                  |

A needs B anyway as soon as Custom Tools or Page Object Tools must be reachable, so A alone is the only option that reaches neither. The typing gap of B is real but closable: the Browser Tool schemas would become `as const` literals (or hand-written input types kept beside them) to derive the map. That conversion is work and is inferred, not probed (F12). A Custom Tool's input is always `{ ref }`, so it needs no per-tool type; typing Page Object Tool inputs would need compiler-generated types and is out of reach today.

All three keep their behaviour when WebMCP publication is disabled: none of them goes through the driver, and F2 shows the underlying path already does not.

## 4. Choices the executor makes that `runTool` made for the Inspector

**Errors.** `runTool` returns `isError` results because it imitates an agent. For application code, the README's own principle (F8) and the `pursueGoal` precedent (F7) both point to throwing the `AymeError` subclasses, which carry `kind`. Returning `isError` instead would make an application handle an MCP result shape, and the Inspector would keep its own conversion. An action failure inside a tool (for example a `TimeoutError` from Playwright Lite) would propagate as it is.

**Caller.** An application's call made as `"agent"` moves the calling agent's cursor (F9). If an agent is connected over WebMCP at the same time, its next `changes` would omit what the application did, because the application's call already "received" that page on the agent's behalf. A third caller kind for application code keeps each Change Record honest; sharing `"agent"` is simpler and matches today's `runTool`. `Caller` already carries a note that the Goal Loop's reader id is temporary (#168), so a new caller kind touches that design.

**Session binding.** The tool sets are module-global (F10). A session member should check its own started state, as `pursueGoal` does, and throw `RuntimeStateError` otherwise, rather than act on whatever owner is active. This is what makes it a session interface and not a second route to global state, the concern #324 raised for a document-global helper.

**Names.** The executor uses registry names, so `toolNamePrefix` does not apply (F11) and an application's code reads the same names the Goal Loop uses.

## 5. Ownership, lifecycle and the shared browser/Node package

- **Startup and disposal.** The member works between `start()` and its stop function, like `pursueGoal`. Custom Tools and the Goal Loop are configured on start and cleared on stop (F10), so a call after stop must throw, not run against an empty tool set. During server rendering the member throws, as `session.page` does.
- **Browser-only.** Every tool in the set needs a `Document`; Custom Tools receive an `Element` (F14). The member is browser-only, as the session is.
- **Node.** Nothing in this proposal runs in Node. The executor's shape, a tool name and JSON input in and a JSON result out, is the shape a Node-side caller could reach through `page.evaluate`, as `/testing` does today through publication (F14). Typed methods taking an `Element` or an `AriaRef` object do not cross that boundary as directly. This is an inference about a future Node design, not a proposal for one.

## Recommendation

Add one executor to the runtime session (option C): run a live tool by its unprefixed name with JSON input and resolve with its result, list the live tools, and type the Browser Tools' inputs. Build it on `runTool`'s resolution and probe, calling `executeAs` with an explicit caller; keep `runTool`'s agent-imitating wrapper for the Inspector. Do not add a method per Browser Tool. If this lands, the internal `ayme` helper's `click` and `fill` become redundant (F6).

## Owner decisions

- **O1. Shape:** executor (B), executor with typed Browser Tool inputs (C), or typed methods (A).
- **O2. Errors:** throw `AymeError` subclasses, or return `isError` results like `runTool`.
- **O3. Caller:** a new caller kind for application code, or share the calling agent's cursor.
- **O4. Coverage:** whether the executor also runs `snapshot` and `goal`, given `pursueGoal` exists, or only actions (Browser, Custom and Page Object Tools).
- **O5. The internal `ayme` helper:** remove it, or keep it for its readers (`getPageState`, `getPageContext`, `getPomDefinitions`) without `click` and `fill`.
- **O6. Member name on the session.** The `ayme` naming question is closed (#243); this is only the member's name.

Out of scope here: implementing or publishing the member, the Browser Tool inventory (#242), `snapshot`'s payload (#119), an ADR or glossary change.
