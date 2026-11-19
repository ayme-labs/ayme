# Playbook: mirroring test

The result is page objects and one Playwright test that replays the recorded
flow against the app.

1. **Propose** the page objects and the test to the user before you write any
   file, following
   [Write page objects from the recording](../SKILL.md#write-page-objects-from-the-recording)
   and [Write the test](#write-the-test). Settle it with them.
2. **Write** what you agreed, following
   [Page object design](../references/page-object-design.md). Where it
   conflicts with the project's existing POM and test conventions, raise the
   conflict with the user.
3. **Run** the test until it passes. Fix locators and timing, but not the
   flow. When passing would take different steps or different checks, stop
   and tell the user. That happens, for example, when the app no longer
   behaves as recorded.

Done when the test passes against the app and replays the flow you agreed.

## Write the test

One test replays the flow in recorded order, with no steps the user did not
take and no branching. Every step goes through a page object action or one
of its named locators. Every check goes through a page object locator or
method. When an action returns one of several page objects, assert the one
the recorded flow reached, rather than branching on it. For example,
`dialog.create()` in
[Page object design](../references/page-object-design.md#return-where-the-user-continues)
returns a `ProjectPage` or the dialog. After
`const created = await dialog.create()`, write
`assert(created instanceof ProjectPage)`, with `assert` from `node:assert`.

Turn the timeline into assertions:

- Assert what a step caused beyond the element it acted on: something appears,
  disappears or is replaced, a count changes, a page opens.
- Assert a value or choice the user entered or interacted with when it shows up somewhere else or
  later, such as an added item in the cart.
- Leave out the acted element's own change, such as a filled value, focus or a
  checked box, what the page already showed, and changes unrelated to the
  flow, such as animations or clocks.
- An `assert*` interaction, such as `assertVisible`, marks a point where the
  user checked something: from its `targetSelector` and the changes around
  it, work out what they meant to check, and assert that.
- Each assertion checks one fact. An `<added>` node can take the place of a
  `<removed>` node with the same role, as the cart button in
  [Read the package](../SKILL.md#read-the-package) does. Check in the trace
  whether the new element is the old control drawn again, as
  [Use the trace](../SKILL.md#use-the-trace) shows. When it is, the element
  re-rendered, and that is one fact: its new content. For that cart button,
  held as `cartLink` by a `Header` component `header`:

  ```ts
  await expect(header.cartLink).toHaveAccessibleName("Cart, 2 items");
  ```

  When the trace does not show it is the same control, treat them as two
  elements.

  When a different element takes the old one's place, such as a confirmation
  that replaces a form, that is two facts: the old one is gone, and the new
  one is visible.

- Steps that only change their own element, such as filling the fields of one form, need no
  assertions in between; assert after the step that submits it.
