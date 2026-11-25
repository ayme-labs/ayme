# Evidence

Evidence shows a change the way its consumer meets it, captured from the running product in the
before and the after state. Captures are for what runs. For docs and file formats, the before and
after view, the lines the consumer reads, is the evidence.

1. Take the changes the user names, or every change in the [review](review.md) when they name none.
   Reuse the evidence the pull request already has, labelled with where it came from, and capture
   only what it is missing.
2. Run the product in each state, set up so the change shows. How to start the product belongs to
   the opening part of `ayme/CONVENTIONS.md`. When it is missing there and the repository says it
   elsewhere, add a line that points to that place. When the repository says it nowhere, ask the
   user, write their answer there, and tell them you did. When the product as it stands cannot show
   the change, add throwaway files that set the scene, untracked and removed afterwards, and say in
   the evidence what they were.
3. For each change, capture what its consumer sees in both states, following the same steps in each.
   When the project has ayme, drive a UI through its Page Object Tools, as the `ayme` skill
   describes, and make the same tool calls in the before and the after state.
4. Put the evidence under the change in place of its before and after view. Keep that view beside it
   when the evidence alone is hard to comprehend, such as a full-page screenshot or a full JSON
   payload.
5. For a change you cannot show running, keep its before and after view and mark it as read in the
   code, not run.
6. Post the review with its evidence where it is read, and leave the environment as you found it. On
   a pull request, attach images and recordings to the review's comment, so they sit in the host's
   storage and outside the repository. On GitHub, `gh pr comment --attach` posts them;
   `gh pr comment --edit-last` edits only your last comment on the pull request, and a patch through
   `gh api` edits any comment but cannot attach.

Evidence is done when every change taken in step 1 has evidence from both states, its before and
after view for docs and file formats, or a marked view.
