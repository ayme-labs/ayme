# Should the browser runtime record its interactions in core's observation model?

Research note, 2026-09-24. Read-only investigation of this repository at `fd658cb`; nothing was prototyped.

**Question.** Every caller of the browser runtime in `packages/webmcp` (a coding agent through WebMCP tools, a Goal Loop step, a standalone consumer of `ayme.click`) acts and then wants to know what changed. Today the runtime keeps one baseline (`callerPageState` in the Page State Session) and renders one Change Record per action, which `completeAction` returns and then forgets. Core ships an observation model (`StructuralObservationSession`, `StructuralTimeline`, Visits, Structural Actions, action changes with before, change and after trees) that webmcp does not use. Should the runtime record its interactions in that model, so that a Handover can carry what changed (#118), `get_page_context` can report changes since the last read (#119), and a later, more capable model can read the whole interaction history of a page or derive Page Objects from it?

**Scope.** Sections 1 and 2 describe the two models as they are. Section 3 maps one onto the other. Sections 4 to 6 weigh what callers would gain, what it would cost, and the options. It presents options and does not decide.

Citations are `path:line-line` in this repository at `fd658cb`, GitHub issues of `ayme-labs/ayme` by number, and ADRs under `docs/adr/`. Glossary terms are used as `CONTEXT.md` defines them. "Visit", "Structural Action", "observation" and "cursor" are not glossary terms; they are core's code names or this note's working words, and adding any of them to `CONTEXT.md` needs the approval `AGENTS.md` asks for.

## Facts

1. Core's observation model is one ordered store of four entry kinds: `navigation`, `observation`, `action-started`, `action-completed`. Every entry carries a monotonic `at` and a `pageId` of type `PlaywrightPageId` (`packages/core/src/observation/StructuralTimeline.ts:16-24,127-163`). Entries are inserted by `at`, not appended (`:657-661`).
2. A Visit is not stored; it is derived from navigation entries. A navigation opens a new Visit when the normalized URL differs from the page's previous one and the difference is not hash-only (`StructuralTimeline.ts:93-125`, `:76-91`). The `cause` vocabulary is `initial | navigate | openPage` (`packages/core/src/observation/Visit.ts:9-15`).
3. A Structural Action is an id plus a start and a completion entry; the entry has no payload beyond `actionId`, `pageId`, `at` (`StructuralTimeline.ts:145-157`). Ids are minted `interaction_N` (`packages/core/src/observation/StructuralActionIdFactory.ts:4-14`).
4. Action evidence is derived, not stored: `getActionEvidence` replays the owning Visit's observations, picks a before boundary (latest observation strictly before the start), an after boundary (the observation tagged `capturedForActionId`, with fallbacks), reconciles them, and reports `unassignedChanges` (baseline to before) plus `actionChange` (before to after). The baseline is the previous action's after tree, projected forward with `toCurrentTree()` (`StructuralTimeline.ts:331-354,355-567`).
5. An observation's tree is a lazy handle: `StructuralTreeEvidence` is `{ pageId, capturedAt, resolve(): Promise<StructuralTree> }` (`packages/core/src/capture/StructuralTreeEvidence.ts:51-55`). A resolver may be swapped per query (`StructuralTimeline.ts:8-14`).
6. Core's capture service takes a `LiveAriaSnapshotSource` that returns two YAML strings for a `PlaywrightPageId`, parses lazily and memoizes the parsed tree per evidence handle (`packages/core/src/capture/LiveAriaSnapshot.ts:3-12`, `packages/core/src/capture/StructuralTreeCaptureService.ts:21-52,54-100`). It does not know DOM elements.
7. The timeline, session and capture service have not changed since they were introduced in `aaa0aa9` (PR #44); `git log` on those files shows that one commit.
8. Nothing outside `packages/core` imports `StructuralObservationSession`, `StructuralTimeline`, `StructuralTreeCaptureService`, `StructuralTreeEvidence`, `VisitId` or `StructuralActionId` (repository grep across `packages/` and `apps/`).
9. webmcp imports from core only: `StructuralTree`, `StructuralNode`, `SyntheticAriaRefFactory`, `AriaRefSchema`, `projectStructuralNodeForest`, `renderCompactStructuralNodeForest`, `waitForSettled` with its two constants, `PageActivitySource`, `MonotonicClock`, `MonotonicTimeMsSchema`, and the types `StructuralRole`, `ProjectedStructuralProperty` (import lines of `packages/webmcp/src/{pageState,capturedTree,pomRootPlacement,changeRecord,actionSequence,browserMonotonicClock,pageActivitySource,goalLoopQuestions}.ts`).
10. webmcp captures the page itself with `captureAriaSnapshot(root)` from the bundled Playwright fork, which yields distilled text, full text and an element-to-ref map (`packages/webmcp/src/pageState.ts:1,478`; shape shown in `packages/webmcp/src/pageState.test.ts:590-598`). Issue #125 records this as the deepening opportunity.
11. One `PageStateSession` exists per `Document` (`pageState.ts:84,187-194`). It holds two trees, `baseline` (the previous capture, for ADR-0012 continuity) and `callerPageState` (the Structural Page State the caller last received), plus the alias maps (`pageState.ts:196-207`).
12. `callerPageState` is set by `getPageState` (the path of `get_page_context`), by `getPageStateCapture(forCaller = true)` (the Goal Loop step), and by `captureChangeRecord` (the Settled Page after every action). Captures for ref resolution and for elements do not set it, except that the very first capture stands in while the caller has received nothing (`pageState.ts:211-234,247-257,266-271`).
13. `completeAction` waits for a Settled Page, captures once, reconciles against `callerPageState`, renders the changed subtrees and returns `{ result?, page_changed, settled, changes? }`. The reconciled tree is not kept (`packages/webmcp/src/actionSequence.ts:12-17,30-54`).
14. The Goal Loop's `executeToolAction` reads only `page_changed` from the action result and drops `changes` (`packages/webmcp/src/goalLoop.ts:124-134`). A Handover carries `history[]` of `{ did, result, page_changed }` and no tree (`goalLoop.ts:99-115`).
15. Each Goal Loop step captures `forCaller: true` before deciding, so the step's tree replaces whatever baseline the calling agent had (`goalLoop.ts:242-250`).
16. A reconciled node carries the after (current) ref unless both refs are synthetic (`packages/core/src/tree/StructuralTree.ts:876-910,964-972`), so the refs in a Change Record are refs the agent can act on.
17. webmcp records no navigation: no `pushState`, `popstate` or `location` handling exists in `packages/webmcp/src` outside the navigation timeout option (`packages/webmcp/src/browserPage.ts:18`). A full document reload ends the Page State Session (ADR-0012).
18. ADR-0024 measured one browser capture at about 6 ms plus 30 µs per DOM element on the main thread and ruled out polling captures.
19. A Ref Tool action takes two Page State Session captures (ref resolution, then the Settled Page) plus one fork-level `ariaSnapshot` for the action itself (`packages/webmcp/src/refTools.ts:75-88,91-109,138-144`; `pageState.ts:266-271`; `actionSequence.ts:41`). A Generated WebMCP Tool takes one or two (`packages/webmcp/src/registry.ts:979-995`).
20. The inspector captures through `getPageStateForElements` and the stateless `capturePageState` (`packages/webmcp-inspector/src/useInspector.ts:54,127`); the baseline test pins that such captures do not consume a Change Record (`packages/webmcp/src/changeRecordBaseline.browser.test.ts:173-188`).

## 1. Core's observation model as it is

### 1.1 Entry kinds

`StructuralTimeline` is "a session-wide, time-ordered structural event store" (`StructuralTimeline.ts:198-208`). Its four entry kinds:

| Kind               | Fields                                                                         | Source                        |
| ------------------ | ------------------------------------------------------------------------------ | ----------------------------- |
| `navigation`       | `at`, `pageId`, `fromUrl`, `toUrl`, `cause`, optional `startedVisitId`         | `StructuralTimeline.ts:16-24` |
| `observation`      | `at`, `pageId`, `tree: StructuralTreeEvidence`, optional `capturedForActionId` | `:127-143`                    |
| `action-started`   | `at`, `pageId`, `actionId`                                                     | `:145-150`                    |
| `action-completed` | `at`, `pageId`, `actionId`                                                     | `:152-157`                    |

Entries are inserted in `at` order because "capture order is not event-time order: background polling and delayed action completion can interleave" (`:198-202`, `:657-661`). The doc comment on `observation` distinguishes "polling observations" from "the explicit post-action capture for a specific action", which is authoritative for that action's after state (`:137-142`).

### 1.2 Visits

A Visit has no entry of its own. `deriveVisitsFromEntries` walks the navigation entries that carry `startedVisitId` and collects each Visit's URLs up to the next visit-opening navigation on the same page (`StructuralTimeline.ts:37-91`). `StructuralObservationSession.prepareNavigation` decides whether a signal is ignored (same normalized URL), recorded as an in-Visit navigation (hash-only change) or opens a Visit (`packages/core/src/observation/StructuralObservationSession.ts:64-127`; `startsNewVisit`, `StructuralTimeline.ts:116-125`). `prepareNavigation` returns a staged registration with a `commit()`; `recordNavigation` is the one-step form (`:60-62`). Visit ids are `visit_N` and reset with the session (`packages/core/src/observation/VisitIdFactory.ts:7-17`, `StructuralObservationSession.ts:187-190`).

A Visit's bootstrap evidence is "the first structural observation recorded within the visit's window" that resolves; unresolvable early captures (an empty SPA shell) are skipped (`StructuralTimeline.ts:265-317`).

### 1.3 Structural Actions and how action changes are derived

A Structural Action is a pair of `action-started` and `action-completed` entries sharing an `actionId`; the id is opaque to the timeline and carries no tool name, arguments or target (`StructuralTimeline.ts:145-157`). `getActionEvidence(actionId)` derives:

- the owning Visit: the latest visit-opening navigation positioned before the start entry on the same page (`:333-338,369-384`);
- the window: entries from that navigation to the page's next visit-opening navigation (`:386-390`);
- before boundary: the latest observation with `at < startedAt`, walking back over unresolvable ones (`:339-340,486-500`);
- after boundary: the observation tagged `capturedForActionId`; if it completed only after the next action started it is replaced by the latest poll before that start or, failing that, the before state; a crossing action falls back to the source window's last observation; a non-crossing action in an open window without an explicit capture is an error (`:341-347,728-769`);
- baseline: the previous action's after tree, or the Visit's first resolvable observation (`:348,452-481`);
- `unassignedChanges`: the reconcile from baseline to before, omitted when it has no changes (`:349,510-536`);
- `actionChange`: the reconcile from before to after, with `beforeStructuralTree`, `structuralTree` (the after tree as `toCurrentTree()`), `sourceTreeEvidence` and, for crossing actions, `navigation` (`:350,538-556`; type at `:173-188`).

The chain is threaded: after each action, `baselineTree = actionChangeTree.toCurrentTree()` (`:558-559`), which "preserves tree-id continuity by projecting reconciled current trees forward through prior action boundaries" (`:352-353`). Each query replays from the Visit's first observation up to the queried action; there is no memo across queries, only a per-query cache of resolved handles (`:418-450`).

### 1.4 `StructuralTreeEvidence` and resolvers

`StructuralTreeEvidence` is a lazy handle with `pageId`, `capturedAt` and `resolve()` (`StructuralTreeEvidence.ts:51-55`). The design intent is stated on the `observation` entry: selecting boundaries reads only metadata; "the concrete tree is resolved (replayed/parsed) only for the observations actually chosen as evidence" (`StructuralTimeline.ts:128-136`). `StructuralTreeEvidenceResolver` lets a caller substitute how a handle is turned into a tree; the default calls `evidence.resolve()` (`:8-14`), and both `getVisitEvidence` and `getActionEvidence` accept one (`:271-274,355-358`). Enrichment evidence is a branded token whose resolver is kept in a module `WeakMap` and applied while resolving (`StructuralTreeEvidence.ts:10-49`, `StructuralTreeCaptureService.ts:102-113`).

### 1.5 The capture service

`StructuralTreeCaptureService.capture(pageId)` asks a `LiveAriaSnapshotSource` for `{ distilledYaml, undistilledYaml }`, stamps `capturedAt` from a clock and returns a frozen `StructuralCapture` with `asEvidence(enrichment?)` and `resolveUndistilledTree()` (`StructuralTreeCaptureService.ts:21-52,54-82`). Parsing is deferred and memoized per handle; the distilled tree shares the service's `SyntheticAriaRefFactory` so synthetic refs stay unique across captures (`:36-46,59-65`). The service never sees a DOM element; it works on YAML.

### 1.6 What the tests promise

- Session: staged navigation until `commit()`, defensive copies of visits, ordering by timeline rather than call order, normalized-duplicate URLs ignored, hash-only navigation kept in the current Visit, idempotent commit (`packages/core/src/observation/StructuralObservationSession.test.ts:20-115`).
- Derived Visits: opening, hash append, next Visit on a normal navigation, current Visit per page, unique URLs per window (`packages/core/src/observation/StructuralTimeline.test.ts:257-449`).
- Visit evidence: first observation in window, window scoping across Visits, unknown id, skipping an unresolvable bootstrap (`:451-520`).
- Action evidence: page scoping of interleaved windows (`:523`), resolver used only for selected boundaries (`:589`), out-of-order recording (`:623`), explicit post-action capture as the after state (`:674,893,916`), gap between actions surfaced as the later action's unassigned change (`:817`), error when a non-crossing action has no explicit capture (`:842`), reconciled ids carried forward (`:857`), a delayed explicit capture excluded when the next action already started (`:937,971`), navigating and crossing actions attributed to the source Visit (`:997-1129`), unresolvable baselines and boundaries (`:1131-1235`), `beforeStructuralTree` on the change (`:1237`), crossing and destination queries (`:1262-1327`).
- Capture service: paired snapshot per page with a sample time, lazy memoized enrichment, enrichment failure memoized, shared synthetic allocation across captures and handles, SVG retained for reconciliation (`packages/core/src/capture/StructuralTreeCaptureService.test.ts:42-309`).

The test fixtures build evidence handles by hand around already-parsed trees (`StructuralTimeline.test.ts:63-86`); the timeline does not require the capture service.

### 1.7 Node/Playwright-specific versus runtime-agnostic

Playwright-specific by name or shape: `PlaywrightPageId` on every entry, evidence handle and capture (`packages/core/src/capture/PlaywrightPageId.ts:3-4`); `LiveAriaSnapshotSource.captureAriaSnapshot(pageId, { timeout })` (`LiveAriaSnapshot.ts:8-12`); the Visit cause `openPage`; the notion of polling observations and of an action whose completion "lands in a later visit" (`StructuralTimeline.ts:203-207`), which describes a driver that outlives the document. The core README calls the package an internal building block whose API may change (`packages/core/README.md:3`).

Runtime-agnostic: the entry kinds, ordering, Visit derivation from URLs, boundary selection, the reconcile chain, `MonotonicTimeMs` (webmcp already supplies `performance.now()` through `browserMonotonicClock`, `packages/webmcp/src/browserMonotonicClock.ts:6-8`), `StructuralTreeEvidence` as an interface, and `waitForSettled` with `PageActivitySource` (ADR-0024). `pageId` is a branded string with no Playwright behaviour attached; a browser could pass one constant per document.

## 2. webmcp's model as it is

### 2.1 The Page State Session

`PageStateSession` (`packages/webmcp/src/pageState.ts:196-458`) owns, per `Document`:

- `refFactory`: synthetic refs for placed Page Object Roots (`:197`);
- `baseline`: the previous capture, the reconcile input that carries Structural Ref identities forward (ADR-0012; `:198-199,320-417`);
- `callerPageState`: the Structural Page State the caller last received, the "before" of the next Change Record (`:200-205`);
- `currentIdentitiesByRef` and `identitiesByAlias`: the continuity maps; identities hold the current ref and current `Element` (`:78-82,206-207`).

Public operations and what they do to `callerPageState`:

| Operation                                                                           | Captures                         | Sets `callerPageState`             | Source             |
| ----------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------- | ------------------ |
| `getPageState()` (behind `get_page_context`, `get_page_state`, `ayme.getPageState`) | yes                              | yes                                | `:211-215`         |
| `getPageStateCapture(forCaller)`                                                    | yes                              | only when `forCaller`              | `:217-221`         |
| `ensureCallerPageState()`                                                           | only when the caller has nothing | via the first-capture rule         | `:223-225,247-257` |
| `captureChangeRecord()`                                                             | yes                              | yes, after computing the reconcile | `:227-234`         |
| `resolveRefs()` (before every Ref Tool action)                                      | yes                              | no                                 | `:266-271`         |
| `getPageStateForElements()` (inspector)                                             | yes                              | no                                 | `:236-245`         |

`captureCurrentPageState` is the browser capture: it reads the registered Page Object structure, calls the fork's `captureAriaSnapshot(root)`, excludes ignored and absent-root subtrees, parses distilled and full text with `parseCapturedTree`, places Page Object Roots, projects labels and renders the compact text; it returns `{ text, tree, elementsByRef }` (`:467-611`; `packages/webmcp/src/capturedTree.ts:10-63`).

### 2.2 The action sequence and the Change Record

`completeAction(document, rawResult)` (`actionSequence.ts:30-54`): `waitForSettled` with the browser `PageActivitySource` (DOM mutations plus transition, animation, scroll and resize events; `packages/webmcp/src/pageActivitySource.ts:17-59`), then `captureChangeRecordForDocument`, then `page_changed = changes.hasAnyChanges()`, then `changes = renderChangeRecord(changes)` when something changed. `renderChangeRecord` keeps the path to each added, removed or updated node and prunes unchanged branches (`packages/webmcp/src/changeRecord.ts:19-64`). The reconciled tree is a local and is dropped at return.

All three action kinds end here: Ref Tools through `runRefTool` (`refTools.ts:75-88`), Generated WebMCP Tools through `executeTool` (`registry.ts:979-995`), and the Goal Loop through whichever tool it runs (`goalLoop.ts:119-134`).

### 2.3 How each caller sets the baseline

- **A coding agent** calls `get_page_context`, whose `execute` goes through `getPageStateForDocument` (`packages/webmcp/src/pageContext.ts:24-59`), so every read becomes the baseline; every action's Settled Page then becomes the next baseline (`pageState.ts:227-234`).
- **A Goal Loop step** captures `forCaller: true`, sends `capture.tree` serialized as `page` in the step state (`goalLoop.ts:242-250`; `packages/webmcp/src/goalLoopQuestions.ts:405-417,376-399`), decides in two stages, executes, and records `{ did, result, page_changed }` (`goalLoop.ts:389-398`). The System One model is the caller of record during the run; the calling agent's own baseline is overwritten by step one.
- **A Ref Tool** resolves the requested ref through a capture that does not move the baseline, runs, then completes (`refTools.ts:75-109`).
- **A Generated WebMCP Tool** calls `ensureCallerPageState` first so a tool called without any read still has a "before" (`registry.ts:989-993`; pinned by `packages/webmcp/src/changeRecordFirstAction.browser.test.ts:31`).
- **A standalone consumer** uses `ayme.getPageContext/getPageState/click/fill` (`packages/webmcp/src/ayme.ts:12-27`), the same paths.
- **The inspector** captures without moving the baseline (`useInspector.ts:54,127`).

The rule "last picture plus Change Record equals the current page" came from #109, which separated "what the caller last received" from "the previous capture" (its body, "What to build"); the browser tests in `changeRecordBaseline.browser.test.ts:97-227` pin it for click, fill, Generated WebMCP Tools, two actions in a row, an inspector capture in between, no change at all, and a change while the decision function is pending.

### 2.4 Core pieces used and not used

Used: trees and nodes, the synthetic ref factory, `StructuralTree.fromAriaSnapshotYaml` (through `parseCapturedTree`), `StructuralTree.reconcile` (`pageState.ts:233,332`), `hasAnyChanges`, node `status`, projection and the compact renderer, `waitForSettled` with its constants, `PageActivitySource`, `MonotonicClock` (Fact 9).

Not used: `StructuralObservationSession`, `StructuralTimeline`, all entry types, `StructuralTreeEvidence`, `StructuralTreeCaptureService`, `LiveAriaSnapshotSource`, `PlaywrightPageId`, `VisitId`, `StructuralActionId` and its factory, `StructuralEnrichment` (Fact 8). The migration record lists "capture/session/history" as remaining in core with "no consumer defaults added" (`docs/verification/webmcp-core-migration.md:16`).

## 3. Mapping

| webmcp concept                                   | Core concept                                                                                                          | Fit                                                                                                                                                                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page State Session (one per `Document`)          | `StructuralObservationSession` (one per driver session, many pages)                                                   | Partial: a session per document is one `pageId` in core; the session's continuity maps (alias to identity, identity to `Element`) have no core counterpart (`pageState.ts:206-207`).                                                         |
| One capture (`captureCurrentPageState`)          | `observation` entry with a `StructuralTreeEvidence`                                                                   | Direct for the tree; `elementsByRef` has no place in an entry.                                                                                                                                                                               |
| `callerPageState`                                | none; nearest is the "previous action's after boundary" baseline in `getActionEvidence` (`StructuralTimeline.ts:348`) | Gap: core's baseline is per action chain, not per caller; a `get_page_context` read is not a boundary in core.                                                                                                                               |
| `baseline` (previous capture, continuity)        | threaded `toCurrentTree()` baseline (`:558-559`)                                                                      | Both carry current refs forward; the mechanisms differ (alias maps versus projected tree chain).                                                                                                                                             |
| Change Record                                    | `unassignedChanges` followed by `actionChange`                                                                        | Composite: webmcp's one reconcile from the caller's last state to the Settled Page equals core's baseline-to-before plus before-to-after when the baseline is the caller's last state.                                                       |
| `completeAction`'s post-action capture           | `observation` with `capturedForActionId`                                                                              | Direct (`StructuralTimeline.ts:137-142`).                                                                                                                                                                                                    |
| Ref-resolution capture before a Ref Tool         | a plain `observation` before `action-started`                                                                         | Direct, with a consequence: core would choose it as the before boundary, so the change since the caller's read would land in `unassignedChanges`, not in `actionChange` (`:339-340`). That is the split #109 removed from the Change Record. |
| Waiting for a Settled Page                       | none in the timeline; `waitForSettled` is beside it                                                                   | `settled: false` has no field on any entry.                                                                                                                                                                                                  |
| One action (tool name, args, target ref, result) | `action-started`/`action-completed` with an opaque `actionId`                                                         | Gap: core stores no payload; a side table keyed by `StructuralActionId` would hold it.                                                                                                                                                       |
| A Goal Loop run                                  | none                                                                                                                  | Gap: no grouping entry; a run id would live in the same side table or a new entry kind.                                                                                                                                                      |
| `get_page_context` read                          | a plain `observation`                                                                                                 | Fits, but the caller relation is lost unless recorded.                                                                                                                                                                                       |
| Document lifetime                                | Visit window on one `pageId`                                                                                          | See 3.1.                                                                                                                                                                                                                                     |
| `settled`, `result`                              | none                                                                                                                  | Side table.                                                                                                                                                                                                                                  |

### 3.1 What a Visit means inside one document

Core opens a Visit whenever the URL changes beyond the hash (`StructuralTimeline.ts:116-125`). In a browser runtime that lives inside the page's JavaScript heap:

- A full load or reload destroys the runtime with the document; ADR-0012 already says the Page State Session ends there. An in-memory timeline dies with it. Core's "visit-started" for `cause: initial` would happen once per runtime start, and every action is by construction non-crossing in core's sense except the last one before a full load, whose after capture never arrives. Core handles that case only when the window has closed (`:744-747`); in the browser the window never closes because no later navigation is ever recorded, so the last action before unload would have no evidence.
- SPA navigation (`pushState`, `replaceState`, `popstate`, hash) keeps the document and the runtime. Core would open a new Visit on a path or query change and keep hash changes in the current Visit, if webmcp fed it navigation signals, which it does not today (Fact 17). The Page State Session's continuity maps would keep working across that boundary (ADR-0012 "SPA navigation and re-rendering"), so a Visit boundary would be a reporting boundary, not a continuity boundary.
- The `cause` vocabulary would need browser values (`pushstate`, `popstate`, `hashchange`) or a mapping onto `navigate`. Detecting `pushState` requires wrapping `history.pushState`/`replaceState`, since the browser fires no event for them.

So inside one document a Visit is "a stretch of the same URL family", useful to a later reader who wants to know which page a Page Object was derived on, and useless to today's callers, who ask about the last action.

### 3.2 Does "the caller" map to a timeline cursor per caller?

Yes, and the mapping exposes what one baseline cannot express. The Change Record is defined as "the difference between the Structural Page State the caller last received and the Settled Page after the action" (`CONTEXT.md`). With a store of observations, "the state the caller last received" is a cursor: the observation last handed to that caller. Today there is exactly one cursor, `callerPageState`, and two callers share it: the coding agent and the Goal Loop's System One model. Step one of `pursue_goal` moves the cursor to the step's tree (Fact 15), so after a run the agent's "last received" state is gone and a run-level Change Record for #118 cannot be computed from the session. A per-caller cursor keeps the agent's observation while the model's cursor advances per step. This does not need a timeline; it needs the observations that cursors point at to stay alive while any cursor references them (see option (c) and (d2) in Section 6).

### 3.3 How a Goal Loop run would appear

As a sequence of Structural Actions, one per executed step, interleaved with the step's `forCaller` observation before each `action-started` and the Settled Page observation tagged with the step's action id after it. Core has no group concept; a run would be a range of action ids plus a run id in a consumer-side record, alongside what `getLastGoalLoopRunResult` already keeps for the last run only (`goalLoop.ts:63-87`). Steps that end in a Handover before executing (`done`, `needs_value`, `no_fitting_option`) produce an observation with no action.

### 3.4 What identity a Structural Action would carry in the browser

Core gives an opaque `interaction_N`. The browser knows more at `completeAction` time: the tool name, its validated arguments, for a Ref Tool the requested ref and the resolved current ref and `Element` (`refTools.ts:81-87`), for a Generated WebMCP Tool the Page Object instance and method (`registry.ts:979-987`), the Goal Loop step index and `did` label, the JSON `result`, and `settled`. None of it fits an entry; all of it belongs in a side record keyed by the action id, which is also what a Page Object deriver would need (which element, in which role and name, was acted on).

### 3.5 What evidence and capture storage would mean in memory

In core the handle is lazy because the source is a YAML string that may never be parsed (`StructuralTreeCaptureService.ts:59-65`). In webmcp the tree is already parsed at capture time, and `elementsByRef` holds live `Element` references (`pageState.ts:604-608`). An evidence handle around a parsed tree is what the core tests do (`StructuralTimeline.test.ts:70-86`); laziness buys nothing. Two storage rules would follow: store trees, never `elementsByRef`, in any retained entry, or removed DOM subtrees are kept alive; and keep the alias maps as they are, since they already discard removed elements by nulling `currentElement` (`pageState.ts:399-408`). Once resolved, core's handles memoize the tree for the life of the entry (`StructuralTreeCaptureService.ts:91-99`), so a browser timeline holds one `StructuralTree` per observation for the life of the document either way.

## 4. What each caller would get from a timeline that they cannot get today

**Handover `changes` (#118).** Two shapes are on the table in the issue: one Change Record for the whole run against the state the calling agent last received, or one per step. Per step is available today without any new store: `completeAction` computes and renders `changes` for every executed step, and `executeToolAction` drops it (Fact 14). A whole-run record needs the agent's observation from before step one, which one shared baseline overwrites (3.2). A store, or a second cursor, makes it a single `reconcile(agentObservation.tree, lastSettledPage.tree)`.

**`get_page_context` with changes since the last read (#119).** "Since the caller last received anything" is computable today: `reconcile(callerPageState, freshCapture)` inside the session. What a store adds: changes since a named earlier read, the list of actions that happened in between with their per-action changes (for an agent that shares a page with another caller), and a typed tree the issue asks about, which the session already returns internally as `PageStateCapture.tree` (`pageState.ts:61-66`).

**Replay and derivation of Page Objects later.** Requires, per action, the identity of what was acted on (3.4), the before tree, the change tree and the after tree, in order, with the URL family (Visit). Neither model has it today: webmcp keeps nothing, core's timeline keeps no payload. It is the one use in this list that needs the whole history rather than a cursor, and it only exists if something records it while the tab lives.

**The evaluation harness (#121).** Today the harness material is `getLastGoalLoopRunResult` (last run only: per-step scores and the Handover, `goalLoop.ts:63-87`) and the two live goals in `apps/example-vue/tests/goals.spec.ts`, which assert the Handover reason and the DOM after the run. A per-step record with the state sent, the options offered, the answer, the action and its change would let the harness compare question wordings on what actually happened on the page, not only on the reason. That record is the same side table as 3.4.

**Page drift (#117).** Not asked in the brief, but adjacent: a store with the step's `forCaller` observation and the ref-resolution observation right before dispatch makes "did the target change between decision and dispatch" a reconcile between two observations that both exist already.

## 5. Costs and risks

**Capture cost.** Recording adds no captures if the store only records the captures webmcp already takes (Fact 19). Per Ref Tool action that is two session captures at about 6 ms plus 30 µs per element each (ADR-0024). A Goal Loop step adds the `forCaller` capture and the root probe. Any design that adds a capture (a navigation-time observation to open a Visit, for instance) pays the same price on the main thread.

**Memory in a long-lived tab.** Today the session retains two trees plus the alias maps, which ADR-0012 already flags as growing for the session lifetime. A timeline retains one tree per observation: two to three per action, one per read, for as long as the document lives. A tree is proportional to the captured DOM; an agent session of a few hundred actions on a large page holds a few hundred trees. Core has no eviction; `reset()` drops everything (`StructuralObservationSession.ts:187-190`). A browser store would need a bound (a ring, a per-Visit cap, or eviction of observations no cursor references).

**Query cost.** `getActionEvidence` replays reconciles from the Visit's first observation through every earlier action in the window (`StructuralTimeline.ts:484-560`) and scans entries with `findIndex` per action (`:689-712`). For the k-th action that is k reconciles on the main thread at the moment the agent waits for its result. webmcp today does one reconcile per action. Using the timeline as a store while computing the Change Record directly (two trees, one reconcile) avoids this, at the cost of not using core's evidence derivation.

**Semantic mismatch.** Core's `actionChange` starts at the latest observation before the action, which in webmcp is the ref-resolution capture; the change since the caller's read becomes `unassignedChanges`. Rendering only `actionChange` would silently reintroduce the drift #109 closed. Adopting core's derivation means either rendering both parts as one Change Record or marking caller reads as boundaries, which core does not model.

**API surface.** Public today: `ActionResult`, `Handover`, `PageContext`, `PageState`, `RefResolution` (`packages/webmcp/src/index.ts:11-14`). Any of the options that exposes history to a caller adds a tool or a field, which the fixed shapes of #82 guarded; #118 and #119 both say the shape needs a grilling first. Core's types (`PlaywrightPageId`, the `cause` enum) would become part of webmcp's internal contract with core, whose README reserves the right to change it.

**What moves where.** (a) and (b) put navigation detection, action side records and caller cursors into webmcp; whether the cursor concept belongs in core (so that core's Change Record matches the glossary) is an ADR-sized question. (c) touches only `pageState.ts`, `goalLoop.ts`, `actionSequence.ts`. Rough size, excluding tests: (a) 300 to 450 lines in webmcp plus possible core changes to generalize `pageId` and `cause`; (b) 200 to 300 lines in webmcp; (c) 40 to 100 lines; (d1) 30 to 60 lines.

**Risks specific to the browser.** Retaining `Element` references in history leaks removed DOM (3.5). `performance.now()` is monotonic per document, so `MonotonicTimeMs` is safe; it restarts with the document, which is fine because the store does too. A history that lives in `globalThis` like the other webmcp stores (`goalLoop.ts:31-37`) survives runtime `stop()`/`start()`; today `stop()` clears configuration but not the Page State Session (`packages/webmcp/src/runtime.ts:144-160`), so lifetime rules would need stating.

## 6. Options

Each option says what #118, #119 and #125 become under it.

### (a) Adopt `StructuralObservationSession` in the browser as is

webmcp creates one session per document with `browserMonotonicClock`, a constant `pageId`, records `initial` on start, wraps `history.pushState`/`replaceState`/`popstate`/`hashchange` into `recordNavigation`, records every session capture as an `observation` (a handle around the parsed tree), brackets `completeAction` with `action-started`/`action-completed` and tags the Settled Page capture with the action id. Change Records come from `getActionEvidence`, rendered as `unassignedChanges` plus `actionChange`. A side table holds tool, args, target, result, `settled`, run id.

- #118: per step from `getActionEvidence`; whole run by reconciling the agent's cursor observation against the last after observation (a cursor the session does not model, so the side table holds it).
- #119: changes since a cursor by direct reconcile of two observations; the typed tree is the observation's tree.
- #125: becomes more attractive but not required. An adapter `LiveAriaSnapshotSource` over `captureAriaSnapshot(root)` would lose `elementsByRef`, so webmcp would keep a side map per capture either way; the evidence handle can be built without the capture service, as core's own tests do.
- Cost: highest; the replay cost and the semantic mismatch of Section 5 apply; `PlaywrightPageId` and `cause` leak into webmcp; Visit and Structural Action would want glossary entries.

### (b) A browser-side timeline in webmcp that shares core's entry types

webmcp keeps its own store of `StructuralObservationEntry`, `StructuralActionStartedEntry`, `StructuralActionCompletedEntry` and `StructuralNavigationEntry` values (core exports the types, `packages/core/src/index.ts:57-68`), possibly using `StructuralTimeline` as the ordered container, but computes Change Records itself from cursors: one reconcile per action, exactly as today, with the before tree taken from the caller's cursor observation instead of `callerPageState`. Per-caller cursors, the action side table and a memory bound live next to it.

- #118: whole run and per step from cursors and side table; no replay.
- #119: since-cursor changes and the intervening actions.
- #125: unchanged; independent.
- Cost: medium; the store is new code in webmcp, but the Change Record semantics stay those of #109; core's `getActionEvidence` and Visit derivation are unused, so sharing the types is mostly a naming alignment for a later reader. A future core-side reader could ingest the same entries.

### (c) Keep the baseline model and add a bounded ring of recent action changes

`PageStateSession` gains a second cursor for the calling agent so a Goal Loop run does not overwrite it, and a fixed-size ring of the last N action records `{ startedAt, endedAt, tool, args, target, settled, changeTree }` appended by `completeAction`.

- #118: whole run from the agent's cursor at run start against the last Settled Page; per step directly from the `changes` that `executeToolAction` already receives and drops.
- #119: since-last-read by `reconcile(callerPageState, fresh)`; the ring lists the last N actions and their changes.
- #125: unchanged.
- Cost: lowest; replay and derivation beyond N are not available; no navigation, no Visit.

### (d) Other

- **(d1) An opt-in recorder hook.** webmcp keeps nothing; `completeAction` and the caller-facing reads emit records (`observation`, action with payload, navigation) to a subscriber the app or a dev tool installs (like `installRuntimePageInstrumentation`, `runtime.ts:47-54`). Memory stays O(1) in the runtime; the consumer (a harness, the inspector, a future deriver, a Node-side sink) decides retention. #118 and #119 still need (c)'s cursors; replay becomes the subscriber's job; #125 unchanged.
- **(d2) Per-caller cursors without any history.** Only the cursor split of 3.2, with named callers (agent, Goal Loop model, inspector). Solves the whole-run Change Record and nothing else.
- **(d3) Move the cursor into core.** Add to core's timeline the notion of an observation received by a caller, so that core's evidence derivation can produce a Change Record as the glossary defines it, and the Node-side consumer could use the same rule. This is an ADR and a core API change; it is the only option that removes the semantic mismatch instead of working around it.

## Open questions

1. Which caller is "the caller" of a Handover: the coding agent that called `pursue_goal`, or the System One model that saw each step? The answer decides whether #118's `changes` is one record or a list, and whether a per-caller cursor is required at all.
2. Should a caller read (`get_page_context`) be a boundary in the observation model? Core says no; the glossary's Change Record says yes. This is the (d3) question.
3. Does anyone need Visits inside one document before a Page Object deriver exists? If not, navigation recording can wait, and options (b) and (c) need no `history` wrapping.
4. What bound is acceptable for retained trees in a long-lived tab: a count, a per-Visit cap, or eviction of observations no cursor references?
5. Where should the action payload (tool, args, target, result, `settled`) live if core's entries stay payload-free: a webmcp side table, or a new core entry field?
6. Does the harness (#121) want the state sent to the model per step, which is already serialized in `buildStepState`, retained in the same record?
7. Is the drift check of #117 a consumer of the same two observations, and would that change which option is preferred?
8. Should `stop()` clear the history with the Page State Session, or does the history belong to the document rather than the runtime session?

## Sources

Repository files at `fd658cb`:

- `CONTEXT.md`
- `docs/adr/0009-let-ayme-own-live-page-object-observation.md`, `0011-capture-only-the-top-level-document.md`, `0012-preserve-best-effort-node-continuity-in-page-state-sessions.md`, `0022-build-decision-requests-in-the-browser.md`, `0023-register-ref-tools-once-for-agents-and-the-goal-loop.md`, `0024-core-owns-the-meaning-of-a-settled-page.md`
- `docs/verification/webmcp-core-migration.md`
- `packages/core/src/index.ts`, `packages/core/README.md`
- `packages/core/src/observation/StructuralTimeline.ts`, `StructuralTimeline.test.ts`, `StructuralObservationSession.ts`, `StructuralObservationSession.test.ts`, `Visit.ts`, `VisitIdFactory.ts`, `StructuralAction.ts`, `StructuralActionIdFactory.ts`, `waitForSettled.ts`, `PageActivitySource.ts`, `MonotonicClock.ts`
- `packages/core/src/capture/StructuralTreeCaptureService.ts`, `StructuralTreeCaptureService.test.ts`, `StructuralTreeEvidence.ts`, `LiveAriaSnapshot.ts`, `PlaywrightPageId.ts`, `MonotonicTimeMs.ts`
- `packages/core/src/tree/StructuralTree.ts`, `StructuralNode.ts`
- `packages/webmcp/src/pageState.ts`, `pageState.test.ts`, `actionSequence.ts`, `changeRecord.ts`, `changeRecord.test.ts`, `pageContext.ts`, `goalLoop.ts`, `goalLoopQuestions.ts`, `goalLoop.browser.test.ts`, `refTools.ts`, `registry.ts`, `runtime.ts`, `ayme.ts`, `index.ts`, `webMcp.ts`, `capturedTree.ts`, `browserPage.ts`, `browserMonotonicClock.ts`, `pageActivitySource.ts`, `changeRecordBaseline.browser.test.ts`, `changeRecordFirstAction.browser.test.ts`, `refInteractions.browser.test.ts`
- `packages/webmcp/README.md` (Goal Loop and Handover sections)
- `packages/webmcp-inspector/src/useInspector.ts`
- `apps/example-vue/tests/goals.spec.ts`

GitHub issues in `ayme-labs/ayme`: #82 "Spec: Goal Loop" (closed; its last comment records that every ticket merged), #86 "Click and fill wait for a Settled Page and report whether the page changed", #87 "Every action returns a Change Record", #109 "A Change Record compares against the page state the caller last received", #117 "Goal Loop: the page may change between the step's capture and the action", #118 "Goal Loop: the Handover carries what changed", #119 "Rework get_page_context", #121 "Goal Loop evaluation harness", #125 "Deepening: capture through core's capture service".

Commits: `aaa0aa9` (PR #44, introduces core's observation model), `05da02e` (Change Record against the caller's last page state), `223db5a` and `b78caa1` (action sequence and Settled Page).
