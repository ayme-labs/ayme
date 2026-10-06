# Multi-act tests: one Claude Code session per test (2026-10-06)

Local spike on Abel's Mac, nothing committed. Same setup as the single-act comparison:
- The executor runs one Claude Agent SDK session per test, with in-process tools only.
- Model: sonnet, which resolved to claude-sonnet-5-5.
- Login: the Evals Claude Code token, read at run time and never stored.
- Cache: read-write.

The runs went alongside the Evals timed runs, and the load gate paused them twice.

## Tests

- **T1:** create a project, increment the counter twice, create another project.
- **T2:** create a project, remove the counter, bring it back and increment it once.

Both open with the same act, and a locator check runs after every act. The stock arm has only e2e's screen tools. The Ayme arm adds the `ProjectsPage` and `CounterPage` page objects as tools.

## Results (10 of 10 test runs passed, 10 sessions, about $0.24 by the SDK's estimate, no reruns)

| Phase | Stock: sessions / acts sent to Claude / cache | Ayme: sessions / acts sent to Claude / cache |
|---|---|---|
| Record | 2 / 6 / 6 missed, $0.081 | 2 / 6 / 6 missed, $0.066 |
| Replay | 0 / 0 / 6 replayed | 0 / 0 / 6 replayed |
| After renaming "New project" | 2 / 3 / 3 missed (target not found) + 3 replayed, $0.045 | 2 / 3 / 3 missed (page object call failed) + 3 replayed, $0.046. Entries unchanged (md5), 3 repair proposals |
| After the `ProjectsPage` fix | n/a | 0 / 0 / 6 replayed |

## Sessions

- There is at most one session per test. It starts lazily at the test's first act that misses the cache. When all 6 acts replay, no session starts at all. In T2 after the rename, only act 1 needed one.
- Later acts reuse the same session, with no cold start. The cache reads per act grow; for stock T1 they went 9.3k, then 17.5k, then 23.2k tokens.
- Later acts cost less:

  | | Act 1 | Act 2 | Act 3 |
  |---|---|---|---|
  | Stock T1 | $0.0215 | $0.0105 | $0.0153 |
  | Ayme T1 | $0.0185 | $0.0102 | $0.0096 |

- Each act took 3 to 5 turns.

## Claude's choices

- **Ayme arm:**
  - Every project act used `ProjectsPage_createProject`.
  - "Increment the counter twice" became `CounterPage_increment` twice.
  - "Bring it back and increment it once" became a tap on "Mount counter", then `CounterPage_increment`. That mixed entry, a plain action plus a page object call, replays fine.
- **Stock arm:** it always clicked: tap, type, tap for a project, and a tap per increment.

## The mixed case

After the rename, T1 had act 1 handled by Claude, act 2 replayed by the cache, and act 3 handled by Claude in the same session.

- Each message to Claude now carries the test's ledger ("Steps completed so far in this test, including any the cache replayed without you") plus the current screen.
- Claude handled act 3 correctly every time (tap "Add project", type the name, tap "Create"), and it never redid the counter step that the cache had replayed.
- The message text itself was not logged. That the ledger was present follows from how the executor builds the message; it was not seen in a transcript.
- Without the ledger, the session would only see an unexplained change on the screen.

## Ayme arm after the rename

- Every failed replay told Claude which page object call had failed, and Claude never retried it. It clicked through instead.
- The entries stayed unchanged, and the run wrote 3 repair proposals: tap "Add project", type the name, tap "Create".
- After the one `ProjectsPage` fix, all 6 acts in both tests replayed with no session.

## Finding

The stock arm keys its counter taps as `tap button "Increment" in "0"` and then `in "1"`. That container key comes from the live count, which is run data. The entries replay only because every run starts at 0. The Ayme arm's counter steps are page object calls, so they don't have this problem.

## State on the Mac

- The rename and the page object fix are reverted, and the page object matches its backup byte for byte. The dev server is stopped.
- Logs are in `e2e-spike/apps/ayme-spike/.e2e/out/claude/{stock,ayme}-m*/`, where `runsteps.jsonl` has turns, cost and usage per act.
- The earlier single-act repair proposals were moved to `.e2e/out/claude/repairs-single/`.
