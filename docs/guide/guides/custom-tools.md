# Custom Tools

How to register an operation of your own that applies to one element, for agents and for the Goal Loop.

## When to register one

Page Object Tools cover the actions your Page Object Models know, and Browser Tools cover clicking, typing and filling. A Custom Tool covers what neither does: an operation of your app's own, on any element the agent points at. For example:

- Highlight an element or scroll it into view, so an in-app assistant can show the user where something is.
- Open your app's own help or explanation for the element the user is looking at.
- Run an app-specific action that takes one element, such as pinning a card or copying a row's link, without writing a Page Object Model for it.

The Goal Loop can choose a Custom Tool too, so a goal like "show me where the billing settings are" can end on your highlight.

## Register a Custom Tool

A Custom Tool is an operation your app registers for one element at a time. Pass it in `customTools` where Ayme starts. One registration publishes it to Ayme's MCP server, not to WebMCP, and makes it an operation the Goal Loop may choose, as the single-element Browser Tools are:

```ts
import type { CustomTool } from "@ayme-dev/ayme";

const highlight: CustomTool = {
  name: "highlight_element",
  description: "Outline one element on the page so the user can see it.",
  filter: "[data-highlightable]",
  async execute({ ref, locator }) {
    await locator.evaluate((element) => element.classList.add("highlighted"));
    return { highlighted: ref };
  },
};

createAyme({ customTools: [highlight] });
```

## How it runs

- The published tool takes `{ ref }`. Ayme resolves the Structural Ref against the current page and calls `execute` with the current ref and a Playwright `Locator` of its element: act on the element through the Locator, as `locator.click()` or `locator.evaluate(…)` does. An unknown, removed or ambiguous ref fails before `execute` runs.
- `description` is the only instruction the model gets about the operation.
- The call returns the same action result as every other action: a JSON value returned by `execute` appears under `result`, next to `page_changed`, `settled` and, when the page changed, `changes_before` and `changes`.
- `filter` limits only which elements the Goal Loop may offer for this tool. It is not enforced when an agent calls the tool with a ref. Without a `filter`, every node that has a ref may be offered.
- `filter` is a CSS selector, or a function that takes the session's Playwright `Page` and returns a `Locator`, as in [a Locator filter](#a-locator-filter) below.
- A Custom Tool whose name another tool already has leaves the session with no tools: `ayme.tools.list()` is empty, so nothing is published, and `ayme.tools.run` throws until the clash is fixed.
- Custom Tools live as long as the session: they are removed when it stops.

## A Locator filter

A `filter` that a selector cannot express is a function that takes the session's Playwright `Page` and returns a `Locator` of the elements the Goal Loop may offer. Ayme calls it once, when the session starts, and keeps the Locator. The function runs in your own code, so it can use anything around it:

```ts
const linksTable = "Shared links";

const copyLink: CustomTool = {
  name: "copy_link",
  description: "Copy the link a row points to.",
  filter: (page) =>
    page.getByRole("table", { name: linksTable }).getByRole("link"),
  async execute({ locator }) {
    const href = await locator.evaluate(
      (element) => (element as HTMLAnchorElement).href
    );
    await navigator.clipboard.writeText(href);
    return null;
  },
};
```

In the browser, `page` is the session's Playwright Lite page; through `@ayme-dev/ayme/playwright` it is the Playwright `Page` you passed. A function that throws, or returns anything but a Locator, fails `start()` with a `ToolInputError` that names the `filter` of the Custom Tool.

Ayme resolves the Locator again each time, right before it reads the page, so the elements it offers follow the page. One that appears after the Locator resolved and before the page was read is offered from the next page state on.

## Migrating from the earlier shape

Two things changed for apps that registered a Custom Tool or a filter before:

- A filter, here and in the `ignore` option, takes a CSS selector or a function from the session's `Page` to a `Locator`, as above. It no longer takes a function over an `Element`: replace `(element) => element.matches("[data-x]")` with the selector `"[data-x]"`, and a rule a selector cannot say with a Locator, such as `(page) => page.getByRole("row").getByRole("link")`.
- `execute` receives `{ ref, locator }`, never an `element`. A Custom Tool written as `execute({ element })` finds `element` undefined: act through the Playwright `Locator`, as in `locator.evaluate((element) => …)`, which runs your code on the element in the page.

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
