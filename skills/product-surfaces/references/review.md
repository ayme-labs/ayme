# Review

Review a set of changes from the outside: which surfaces of the product they change, and what the
consumers on each surface will notice. The input is a before and an after state of the product, such
as a commit range, a branch against its base or a pull request. When the user gives none, ask for
one. The review changes nothing in the repository.

**Behind the curtain**:
The changed files that made no change on any surface, and the changes no consumer can meet: they
exist in the code, but nothing a consumer does reaches them and no surface shows them. A change a
consumer can meet but that cannot be shown running stays a change in the review, marked as read in
the code, not run.

## Steps

1. Read [the list](list.md) at `ayme/product-surfaces/surfaces.ts`, in the after state. Without a
   list, say so, find the surfaces from the changes alone by the definitions in the skill, and offer
   to write the list afterwards.
2. Read the changes between the two states and find the surfaces they affect. Use the list's names
   for surfaces and consumers. When they affect none, say so in one line.
3. For each affected surface, name the consumers who will notice a change on it, and say in one line
   who meets it but will not notice. Show each change on it [before and after](#before-and-after).
4. Under each change, list the files that made it, tests included, in a collapsible block: one line
   per file, with links on that line to the ranges that made this change. Link on the repository's
   host, pinned to the commit: the after state, or the before state for removed lines. Without a
   host, write `path:line`.

   ```markdown
   <details>
   <summary>Files (2)</summary>

   - src/home/page.ts: [12-40](link), [55-58](link)
   - tests/home.test.ts: [8-31](link)

   </details>
   ```

5. Close with what is behind the curtain, in the same collapsible form, grouped as fits the changes.
   Leave it out when it is empty.
6. Compare the changes with the list. Name every consumer or surface the changes add, remove or
   reshape and the list does not yet reflect, and every source of the list the changes move or
   delete. Propose the edit to the list as [Keep the list current](list.md#keep-the-list-current)
   describes.
7. Show the review where it is read. For a pull request, post it as one comment titled
   `## Product surface review` that carries the hidden line `<!-- product-surface-review -->`, by
   which a tool or an agent finds it. When the pull request changes, find that comment by the line
   and edit it, starting from its posted text so attached files keep their addresses, and attach only
   new or changed files. For any other input, show it in the conversation.

The review is done when every changed file sits under a change or behind the curtain, step 6 found
nothing or proposed its edits, and the review is shown where it is read.

## Before and after

Show each change as its consumer meets it, in the smallest view that makes the difference clear.
Draw the view from the consumer's side of the surface, in the surface's own terms:

- a UI: the screen or component as a tree, with the labels and states the consumer sees
- an API or a tool: the request and the response
- a CLI: the command and its output
- a message: its subject and body
- a file format or docs: the lines the consumer reads

Use one `diff` block when the surrounding shape stays and a part of it changes. Use a before block
and an after block when most of it is new. One or two sentences beside the view say what the
consumer will notice.

```diff
 Checkout
   Shipping address
+  Delivery date            # new: pick a day within the next two weeks
   Payment
-  [Place order]
+  [Place order]            # disabled until a delivery date is picked
```

## Evidence

When the user asks for evidence, with the review or after it, follow [Evidence](evidence.md).
