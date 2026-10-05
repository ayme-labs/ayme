# Page state

What an agent sees of your page: the Structural Page State, the Structural Refs it acts through, and the interaction history Ayme keeps.

## Structural Page State

Once Ayme has started and Page Objects are registered, it captures the Structural Page State: a model-facing view of what the page presents and which Page Objects it holds. It is based on the page's accessibility tree and labels each Page Object Root with its Page Object's name, such as `ListPage.items[0]`. It covers the top-level document only.

Content that is scrollable or blocked by a modal stays in the state. Page Object subtrees known to be hidden or off-canvas are left out. Being in the state does not mean a node can be interacted with.

Page state works without WebMCP publication. An agent reads it with the `snapshot` tool, which returns the state as `structure` and the definitions of the registered Page Object Models as `pomDefinitions`. Your own code runs the same tool with `ayme.tools.run("snapshot", {})`.

## Structural Refs

Each node in the state carries a Structural Ref, such as `e5`. An agent passes it back as the `target` of a Browser Tool, as the `ref` of a Custom Tool, or as the `ref` that picks an item of a Page Object collection. A ref belongs to the capture it came from; within one document, Ayme keeps refs continuous on a best-effort basis, so an earlier ref can resolve to the current version of the same node. A ref that no longer matches anything fails with a `RefResolutionError`.

## Keep parts of the page out

Pass `ignore` where Ayme starts to drop elements, and everything inside them, from the page state:

```ts
createAyme({
  ignore: (element) => element.matches("[data-assistant-panel]"),
});
```

`ignore` changes page state only; it does not change which tools are published.

## Interaction history

Ayme records what happens in the document for the length of its Page State Session: a Visit at load and at each same-document navigation, every tool call and Goal Loop step as an action, and every page state it captures. A full page load starts a new Page State Session and a new history.

Each caller, the calling agent, the Goal Loop's model and your application's `ayme.tools.run`, has its own last-received page state. Every action returns a result with `page_changed` and `settled`, and `changes` when the page changed. `settled` says whether the page went quiet after the action, and `changes`, the Change Record, is the difference between the caller's last-received state and the page after the action. So an agent's next action also reports what your application changed in between. A Goal Loop run leaves its caller's state alone until it hands over.

## Full page loads

A tool call whose action starts loading a new document, such as a click on a plain link or on a form's submit button, answers at once, before the old document goes away and Ayme with it. The answer is the action result with `settled: false`, the Change Record up to that moment in `changes`, the URL the navigation started for in `loading`, and in `next` a note that the page is loading and that `snapshot` is the next call. For a form submit, `loading` is the form's `action`: where the server redirects is not known yet when the answer goes out.

```ts
{
  page_changed: true,
  settled: false,
  changes: `- e2 main:
  - e7 <removed> status: Saved`,
  loading: "http://localhost:5173/session",
  next: "The page is loading http://localhost:5173/session. Call snapshot next to read the new page.",
}
```

This holds for Browser Tools, Custom Tools and Page Object Tools alike. A navigation that stays in the document, such as your client router's route change, a fragment change, or going back to an entry of the same document, waits for a Settled Page like any other action. A Goal Loop step that starts a full load is the run's last; its Handover has the reason `page_loading` and names the URL in `loading`.
