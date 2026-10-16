---
status: accepted
amends: ADR-0035
---

# Browser Tools act only on elements their input would reach

ADR-0035 measures reach for a Page Object's root: a native modal the element is not in, or an inert ancestor, blocks it, and hit testing finds what covers it, without ever naming a kind of widget. We now use that same measurement for the single-element Browser Tools. They offer and accept only elements their input would reach. Pointer input (click, hover, check, uncheck, and a checkbox or radio field of fill_form) needs the whole measurement: a click must reach the element. Keyboard input (type, fill, select_option, and the other fields of fill_form) needs only its first half: the element can take focus, so no open modal it is not in and no inert ancestor blocks it, while an overlay or `pointer-events: none` does not stop typing, as Playwright's own fill shows (ADR-0038). The Goal Loop's ref options and the Inspector's list of refs each tool can take both drop the elements the tool's input would not reach, from one shared closed set (ADR-0023). A Browser Tool call on such an element is refused at once with an Availability Reason worded like a Page Object Tool's, "a click would not reach it; eN is in the way" or "it cannot take focus; eN is in the way", instead of a locator timeout. The Goal Loop's stage-one page state is unchanged: it stays the whole page with nothing marked. Custom Tools are not affected, because an app's tool may not be an interaction. We rejected a second availability algorithm or modal- and dialog-specific logic, since the one measurement already answers the question; holding keyboard tools to a click's reach, which refuses fields a keyboard fills; marking unreachable elements in the page state, which would change what the model reads in every step; and keeping the locator timeout, which says nothing about why the call failed and is slow to say it.

This decision amends ADR-0035.
