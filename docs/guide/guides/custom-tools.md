# Custom Tools

How to register an operation of your own that applies to one element, for agents and for the Goal Loop.

## Register a Custom Tool

A Custom Tool is an operation your app registers for one element at a time. Pass it in `customTools` where Ayme starts. One registration publishes it for the calling agent and makes it an operation the Goal Loop may choose, as the single-element Browser Tools are:

```ts
import type { CustomTool } from "@ayme-dev/ayme";

const highlight: CustomTool = {
  name: "highlight_element",
  description: "Outline one element on the page so the user can see it.",
  filter: (element) => element.matches("[data-highlightable]"),
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
- The call returns the same action result as every other action: a JSON value returned by `execute` appears under `result`, next to `page_changed`, `settled` and, when the page changed, `changes`.
- `filter` limits only which elements the Goal Loop may offer for this tool. It is not enforced when an agent calls the tool with a ref. Without a `filter`, every node that has a ref may be offered.
- A Custom Tool whose name another live tool already has fails publication, with the status `failed`, and `ayme.tools.run` throws until the clash is fixed.
- Custom Tools live as long as the session: they are removed when it stops.
