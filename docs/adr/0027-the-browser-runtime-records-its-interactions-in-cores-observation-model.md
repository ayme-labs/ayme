---
status: accepted
---

# The browser runtime records its interactions in core's observation model

The browser runtime kept one baseline per document, the Structural Page State the caller last received, and rendered each action's Change Record against it, then forgot the record. Two callers shared that baseline, the calling agent and the Goal Loop's System One model, so after a run the agent's own last state was gone; the runtime knew no navigations and kept no history. Core's observation model (Structural Observation Session, Structural Timeline: visits, actions, observations, and the changes derived from them) had until now been driven only from Node.

We decided that the Page State Session drives a core Structural Observation Session for its document. It records a visit at document load and at each same-document navigation (cause `navigate`); an action started and completed around every tool call and every Goal Loop step, keeping the tool, its arguments and its target beside the action id; and an observation for every Settled Page after an action and for every capture the runtime makes for itself, as an already-resolved tree. Changes are derived by the timeline. The Change Record a caller receives is the difference between the observation that caller last received, a per-caller cursor kept by the session, and the action's after observation; the single shared baseline goes. Identity continuity across captures (ADR-0012's aliases) and node lifecycle move into the session as a per-visit ledger derived from the same reconciliation; that lands as the second slice and supersedes ADR-0012 in its own ADR. Everything is kept for the document's life until a measured retention rule replaces that. Core's page identifier names the browsing context a visit happens in, not one host's page type.

## Considered options

- Keep the single baseline and add a bounded ring of recent action changes. Cheapest; gives #118 its whole-run record, but keeps a second, browser-only model of interaction history and nothing for an export or a later reader of the whole history.
- A browser-side timeline in webmcp sharing core's entry types. Avoids core's Node-shaped names, duplicates its derivation of changes and visits.
- An opt-in hook emitting records to a subscriber, the runtime keeping nothing. Memory stays flat, but every caller-facing reading (Handover changes, changes since last read) still needs cursors and retained observations in the runtime.
- Drive core's session from the browser (chosen). One model of interaction history for both hosts; the Handover's changes, changes since the last read, a timeline export and, later, capture through core's service are readings of one record.

## Consequences

- The Handover can carry what the run changed (#118) and a document's interaction history can be exported; both are renderings over the timeline.
- Memory grows by one tree per observation until a retention rule exists; the first slice measures it on the example apps.
- History does not survive a cross-document navigation: a new document is a new session, cause `initial`.
- Core's observation vocabulary is generalised (the page identifier) and becomes part of the browser runtime's contract with core.
- `CONTEXT.md` gains **Visit** and the Page State Session's entry says it records the document's interaction history.
