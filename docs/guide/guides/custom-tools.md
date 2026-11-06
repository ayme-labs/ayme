# Custom Tools

How to register an operation of your own that applies to one element, for agents and for the Goal Loop.

## When to register one

Page Object Tools cover the actions your Page Object Models know, and Browser Tools cover clicking, typing and filling. A Custom Tool covers what neither does: an operation of your app's own, on any element the agent points at. For example:

- Highlight an element or scroll it into view, so an in-app assistant can show the user where something is.
- Open your app's own help or explanation for the element the user is looking at.
- Run an app-specific action that takes one element, such as pinning a card or copying a row's link, without writing a Page Object Model for it.

The Goal Loop can choose a Custom Tool too, so a goal like "show me where the billing settings are" can end on your highlight.

## Register a Custom Tool

A Custom Tool is an operation your app registers for one element at a time. Pass it in `customTools` where Ayme starts. One registration publishes it for the calling agent and makes it an operation the Goal Loop may choose, as the single-element Browser Tools are:

```ts
import type { CustomTool } from "@ayme-dev/ayme";

const highlight: CustomTool = {
  name: "highlight_element",
  description: "Outline one element on the page so the user can see it.",
  filter: "[data-highlightable]",
  async execute({ ref, element }) {
    element.classList.add("highlighted");
    return { highlighted: ref };
  },
};

createAyme({ customTools: [highlight] });
```

## How it runs

- The published tool takes `{ ref }`. Ayme resolves the Structural Ref against the current page and calls `execute` with the current ref and its element. An unknown, removed or ambiguous ref fails before `execute` runs.
- `description` is the only instruction the model gets about the operation.
- The call returns the same action result as every other action: a JSON value returned by `execute` appears under `result`, next to `page_changed`, `settled` and, when the page changed, `changes_before` and `changes`.
- `filter` limits only which elements the Goal Loop may offer for this tool. It is not enforced when an agent calls the tool with a ref. Without a `filter`, every node that has a ref may be offered.
- `filter` is a CSS selector, or a function the page runs over each element. A function is sent to the page by its source, so it must be self-contained, as in [a function filter](#a-function-filter) below.
- A Custom Tool whose name another tool already has leaves the session with no tools: `ayme.tools.list()` is empty, so nothing is published, and `ayme.tools.run` throws until the clash is fixed.
- Custom Tools live as long as the session: they are removed when it stops.

## A function filter

A `filter` that a selector cannot express is a function, which the page runs over each element. It runs in the page on its own, so it may use its own arguments and the page's globals, but not a variable from the code around it:

```ts
const copyLink: CustomTool = {
  name: "copy_link",
  description: "Copy the link a row points to.",
  filter: (element) =>
    element instanceof HTMLAnchorElement && element.closest("tr") !== null,
  async execute({ element }) {
    await navigator.clipboard.writeText((element as HTMLAnchorElement).href);
    return null;
  },
};
```

Ayme checks the function when the session starts. A function that reads a variable from the code around it, such as a selector held in a constant of the module, is rejected there with a `ToolInputError` that names the variable. Pass a CSS selector for that case, or move the value inside the function. A native or bound function cannot be sent to the page, so it is rejected too.

## Use other tools from a Custom Tool

`execute` gets a second argument, `{ run }`. `run(name, input)` runs another available tool as a child Run of the Custom Tool's own Run and resolves with its result, as `ayme.tools.run` does. Child Runs run inside the Custom Tool's turn, never waiting on the page's queue, one after the other in the order it starts them, even when it starts them together, and `ayme.runs` lists them under its Run:

```ts
const submitSample: CustomTool = {
  name: "submit_sample",
  description: "Fill a text field with sample text and submit its form.",
  filter: "input[type=text], textarea",
  async execute({ ref }, { run }) {
    await run("fill", { target: ref, text: "Sample text" });
    await run("press_key", { key: "Enter" });
    return null;
  },
};
```

Never call `ayme.tools.run` from inside `execute`. That starts a separate top-level Run, which waits for the Custom Tool's Run to end, while the Custom Tool waits for it: neither ever finishes. Use the `run` it is handed.
