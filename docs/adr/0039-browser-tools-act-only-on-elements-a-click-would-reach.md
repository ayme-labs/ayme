---
status: accepted
amends: ADR-0035
---

# Browser Tools act only on elements a click would reach

ADR-0035 measures reach for a Page Object's root: a native modal the element is not in, or an inert ancestor, blocks it, and hit testing finds what covers it, without ever naming a kind of widget. We now use that same measurement for the single-element Browser Tools (click, hover, type, fill, check, uncheck, select_option, and each field of fill_form). They offer and accept only refs of elements a click would reach. The Goal Loop's ref options and the Inspector's list of refs each tool can take both drop the elements a click would not reach, from one shared closed set (ADR-0023). A Browser Tool call on such an element is refused at once with the Availability Reason a Page Object Tool gives, "a click would not reach it; eN is in the way", instead of a locator timeout. The Goal Loop's stage-one page state is unchanged: it stays the whole page with nothing marked. Custom Tools are not affected, because an app's tool may not be an interaction. We rejected a second availability algorithm or modal- and dialog-specific logic, since the one measurement already answers the question; marking unreachable elements in the page state, which would change what the model reads in every step; and keeping the locator timeout, which says nothing about why the call failed and is slow to say it.

This decision amends ADR-0035.
