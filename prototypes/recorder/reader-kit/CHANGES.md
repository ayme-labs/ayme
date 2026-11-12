# Skill copy changes

Only `ayme-recorder/SKILL.md`'s **Use the trace** section was replaced.
Everything before that heading and every file in `references/` is byte-identical
to the shipped skill. The shipped files under `skills/` were not edited.

Sentence changes, grouped by their original paragraph:

- “The trace holds a DOM snapshot after each recorded interaction…” and
  “Each element carries its package ref…” now describe an untouched stock
  trace without stamped refs. The sentence about reading the DOM when the
  tree is insufficient keeps its meaning.
- “Name the snapshot by the interaction's id…” and “an action's before
  snapshot cannot be read” now tell the reader to take a **position** from
  `beforeSnapshotId` or `afterSnapshotId`. Both point to the **after phase**
  of a no-op marker; the flag is `--phase` on 1.65, `--name` on 1.62.
- The `eval`/`sed` explanation is expressed by the replacement shell example;
  its input is CSS selectors rather than package refs. The sample result
  containing stamped attributes was removed.
- “Each trace snapshot call takes several seconds,” “List every ref…” and
  the two sentences about `cloneNode(false)`/`outerHTML` and absent refs now
  say to batch selectors and return `null` for absent elements. Tag-only vs
  full-content inspection keeps the same meaning.
- “A targetRef can name a node inside the control…” and “Add its parent's
  ref…” now say to inspect the recorded control and ancestors together;
  this prototype may place a target on its nearest represented ancestor.
- “A snapshot holds the refs of its own visit…” and the final sentence about
  reaching an `s_*` node through an `e` attribute were replaced by matching
  selector, role, name, content and ancestors. Replay refs are unrelated.
- The sentence about a navigation's missing after keeps its meaning; it now
  explicitly says its before position is present.
- Added the typing limitation: the event-based before-tree can include late
  changes absent in the preceding public DOM snapshot used by its trace point.

The commands now use `npx playwright trace`, not the released CLI. The sample
uses this kit's actual archive and position 107. No reader check was run.

Unchanged earlier skill wording conflicts with this trial: it says a re-render
gets a new package ref, that refs link to trace elements, and that discarded
interactions open by interaction id. Those sentences are intentionally left
alone because the brief permits edits only to **Use the trace**. This kit has
no discarded entries. Follow the replacement trace section for this package.
