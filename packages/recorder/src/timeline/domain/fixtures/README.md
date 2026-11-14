# Timeline fixtures

Expected Recording Package text comes from here, never from the code under
test.

- `cart-flow.recording.json`: three clicks on the fixture page
  `apps/recorder-fixture/app/cart.html`, as the timeline is given them: the
  Visit, the raw snapshots Playwright 1.64 returned and the reports of its
  recorder. The second click makes the page re-create the "Add item" button,
  which Playwright then names `e7` instead of `e5`.
- `cart-flow.package.txt`: the Recording Package the throwaway prototype of
  pull request #1268 wrote for that same run, byte for byte. Its writer was
  checked against the released recorder's renderer. A "before" snapshot in
  the JSON carries the moment the prototype wrote for it, when its click was
  held.
