# Page tools

Once the page is connected, its tools are the Browser Tools and the Page
Object Tools it publishes. [Browser Tools](https://github.com/ayme-labs/ayme/blob/main/docs/guide/reference/browser-tools.md)
lists every built-in tool with its input. To connect to the page, or when its
tools are missing, read [Browser setup](browser-setup.md).

- When a ref fails to resolve, call `snapshot` and use the ref it prints for
  that node; if that ref fails the same way, use a selector such as
  `role=button[name="Save"]`. Pass a ref alone, such as `e36`, and for a
  collection tool the ref of the item's Page Object Root.
  [Page state](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/page-state.md#structural-refs)
  says what each failure reason means. Refs belong to one document: after a
  full load, call `snapshot` before you use a ref, since a ref printed before
  the load can name another element on the new page.
- Call a nested item, such as one the page state labels
  `ListPage.items[0].subItems[0]`, through the nearest tool above it on that
  path, such as `ListPage.items.archive`, with its ref.
  [Page Object Children](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/page-object-models.md#page-object-children)
  says which tool takes which nested item.
- When `goal` hands over with `needs_value` because none of a parameter's
  allowed values belongs in it, the loop offered that parameter only its
  allowed values, so a Goal Value of a type it does not take changes nothing.
  Call the tool named in `needs` yourself with the value, or call `goal` again
  with a goal that names it.
- When a tool answers that it is unavailable, read the reason. A runtime
  reason, `a click would not reach it; e42 is in the way`, names the element
  in the way in the page state, such as an open dialog to close first, and
  stops before the ref when nothing in the way has one. A Browser Tool that
  types or selects (`type`, `fill`, `select_option`, or a `fill_form` field
  other than a checkbox or radio) gives
  `it cannot take focus; e42 is in the way` instead, for a field outside an
  open native modal dialog or inside an inert region. Any other reason is the
  app's own, such as `No item is selected`. A Page Object Tool stays listed:
  `ayme_list_tools` shows whether each tool is available and why not,
  and a tool result says which tools became available or unavailable since
  your previous call.
- When a tool answers that it is gone, what offered it is no longer there,
  such as a Page Object that is no longer present, a page that navigated or
  an App Process that stopped. Use one of the current tools instead.
