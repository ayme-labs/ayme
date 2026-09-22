# Goal loop prototype — findings

This records findings from the Goal Loop prototype rounds (2026) that
preceded the shipped `packages/webmcp/src/goalLoop.ts`,
`goalLoopQuestions.ts`, and the Decision Endpoint. The prototype code
itself was not merged. The "show" versus "do" section is the evidence for
distinguishing showing a target from acting on it.

Throwaway (branch `prototype/goal-loop`, local only). Question: does a choice
model (Jev 1.13 via OpenRouter) pick well, step by step, from one flat option
list with the full ayme page context attached?

Verdict: viable enough to keep going. Not a measured success rate.

## Evidence base

About a dozen decisions on the `example-vue` list page (two items, 40–49
options, 1.2–1.6k tokens), mostly one run per goal, plus a few direct `curl`
probes. Run it with `node scripts/goal-loop.prototype.mjs "<goal>"` from
`apps/example-vue`; `AYME_DECIDE_DUMP=<file>` appends each raw Jev exchange.

## Shown

- Wire format: `POST https://openrouter.ai/api/alpha/decisions`, body
  `{model: "typesafe/jev-1.13", state, questions}`; `instructions` and criteria
  values are strings (or `null`). Response:
  `answers.<id>.{choice, probabilities, confidence}` or `.noul` (0–1).
- 0.33–1.3 s and about $0.00006 per decision.
- Jev resolved refs from the structure alone, handled the archive dialog step,
  used the action history on a multi-step goal, and answered "goal satisfied"
  with margin (≤0.34 while work remained, ≥0.89 when done; cutoff 0.5).
- A `none` criterion gives a clean "nothing fits" handover; no confidence
  threshold needed. `fill` options hand over with `needs_value`.

## Observed once — not applied in the loop, not a conclusion

With POM tools on, Jev never picked a POM tool. The option read
`ListPage.items.archive: "Archive this list item."` — it does not say which
item, while `click e36` points at a button labelled "Archive item-2".

`curl` probes on one captured request ("Archive the list item item-2"):

| Variant                                                        | Result                                         |
| -------------------------------------------------------------- | ---------------------------------------------- |
| One option per item (`ListPage.items[1].archive`)              | right item at 0.40, `click e36` wins at 0.60   |
| Separate "which item?" question                                | answers `1` at 1.0; action choice unchanged    |
| One option per item + "prefer a named page action" instruction | `ListPage.items[1].archive` at 0.96–0.98 (3/3) |

The 3/3 is the same request sent three times: one input, one wording. TypeSafe
documents that Jev is not consistent across rephrasings.

## Not shown

- Any success rate; behaviour on a larger page, with many similar options, or
  with distractor content (the conditions TypeSafe says hurt Jev).
- Any benefit from POM tools: every POM tool on this page needs an argument, so
  the loop never executed one.

Real conclusions need a fixed task set over several pages, repeated runs, POM
tools on and off, scored on success rate and decisions per task.

## Second round: inside a real application

The run happened inside a real application that consumed this checkout through
`file:` dependencies. Driven from the browser console and through Playwright
MCP. Still a handful of runs per goal — observations, not rates.

### Shown

- The motivating scenario works: with the sidebar collapsed, `SidebarNavigation`
  is absent from structure and tools; from the POM definitions alone Jev chose
  `AppTopBar.toggleSidebar` first. First time the loop executed a POM tool.
- Page size is not the constraint: 145–232 options, 4.7–6.7k tokens per request.
- "Show me how to log out", with an app-provided `highlight` ref action: toggle
  sidebar → click profile menu trigger → `highlight <Logout item>` at 0.91.

### Changes the real page forced

- **Settle wait after each action.** A page method returns when its click lands;
  the sidebar slides in over 250 ms and is off-canvas (absent) meanwhile. Jev
  answers in ~0.5 s, saw "Collapse sidebar" but no sidebar, and toggled again.
  Playwright timeouts are upper bounds for requested waits, not settle delays.
  `requestAnimationFrame` alone stalls in a background tab; raced with a timer.
- **Hard limit: 255 choices per question** (OpenRouter 400 "Too many choices").
  Reached before the 32k context once a second per-ref action doubled the list.
  Options are now interactive elements only, minus elements with
  `pointer-events: none` (what an open modal menu puts on everything behind
  it). With the profile menu open that leaves 14 options.
- **`refActions`**: the app hands the loop named actions on a ref (the host
  application passes its highlight controller); the loop offers `<name> <ref>`
  per ref. Registering every WebMCP tool was rejected: the list contains
  `pursue_goal` itself and tools whose arguments the loop cannot fill.
- **`final` ref actions.** A highlight leaves no trace in the page structure.
  Asked to judge "goal satisfied" from structure plus action history, Jev did
  not: it highlighted again (0.47), then clicked Logout (0.47 vs 0.45). A
  successful `final` action now ends the run as done. Not re-run after the fix.

### Open

- The first step is unstable: opening a hidden surface got 0.35–0.74; on a page
  that had been expanded and re-collapsed, "none" won at 0.58 three times.
- "Show me" is a soft constraint: the `logout` tool still drew 0.10–0.24 and was
  picked once.
- Steps take a minute or more when the Chrome window is not rendered; suspected
  cause is the application's click-feedback animation awaiting `finished`.
  Unconfirmed.
- `clickNavigationItem(key)` has six fixed values and hands over with
  `needs_value`; expanding enum arguments into options would finish that goal.

## Third round: driven by the application's assistant, and "show" versus "do"

The stock application's assistant backend (no prompt change) called
`pursue_goal` for "How do I log out?" on the strength of the tool
description alone, read the result's `next` hint and answered correctly.
A few runs; not a routing rate.

### What made that work

- The tool description says when to call it; every result carries a runtime-built
  `next` instruction, readable step labels, and `shown: { ref, label }`.
- The assistant's chat panel is excluded from the page state
  (`data-ayme-inspector-host`). With it included, Jev matched the goal against
  chat text: it highlighted the thread title and judged the goal done from the
  assistant's own reply.

### "Show me" — three designs, measured by replaying captured decisions

1. **Per-ref `highlight` options in the one `next` choice, highlight ends the
   run.** At the profile menu button: `click` 0.36–0.39 vs `highlight`
   0.32–0.38, a coin flip, and a highlight there ended the run early.
2. **Wording.** A strict description fixed that step but pushed Jev toward
   really logging out (logout tool 0.14 → 0.26). A description stating only the
   fact "this ends the task" made it worse (highlight 5 of 5). No wording that
   avoids scripting the route worked.
3. **Separate questions (current).** One request, four judgements: `next`,
   `done`, `target` ("which control or named action is the very thing the user
   asked about, or none"), `show` ("shown rather than done?"). `show` scored
   0.81–0.91 on five show phrasings, 0.05–0.31 on five do phrasings. `target`
   was right on every probed state (0.65–0.99). Rule in the loop: a show run
   does not perform the thing being shown — a control is pointed at (done); a
   named action (`logout()`) that `next` picked is withheld and the decision
   repeated. 21 of 21 replays over seven states did the right thing; at the
   profile button Jev picked the `logout` tool 3 of 3 times before the withhold.

The pattern: a compound judgement inside a 100–200 option choice is unreliable;
the same judgements asked separately are decisive. No highlight options means
the option list no longer doubles (205 → 109).

### Open

- Replays of captured states on one page, 3–6 per state. Not a success rate, and
  no full live run of design 3 before this was written.
- `target` for "where is my profile menu" is the thinnest margin (0.65–0.75).
- Step time is mostly decide latency (0.4–2 s) plus the application's
  cursor travel (0.16–1 s); the settle wait also waits ~280 ms for the
  application's own click ripple.
