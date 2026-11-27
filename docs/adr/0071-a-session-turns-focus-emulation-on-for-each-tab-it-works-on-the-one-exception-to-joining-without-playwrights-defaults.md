---
status: accepted
---

# A Session turns focus emulation on for each Tab it works on, the one exception to joining without Playwright's defaults

## Why

A Session joins the developer's browser without Playwright's defaults: the browser belongs to the developer's browser automation, so ayme leaves its settings as they are.

Chromium stops drawing frames for a Tab that is not in front, and Playwright waits for frames before it acts, so on such a Tab a Run's action stalls until its own timeout. A Tab leaves the front during a Run as soon as the action opens a popup or a link in a new tab, or the automation switches to another. With focus emulation on, Chromium keeps drawing the Tab and the Run finishes as it does in front.

## Decision

A Session turns focus emulation on for each Tab it works on, popups and tabs an action opened among them, once it first works on that Tab. This is the one setting a Session changes in a browser it joined, and there is no rule about hidden Tabs.

The Session sets it over a DevTools session of its own, which it keeps while the Tab is open, because Chromium keeps the setting only as long as that session.

## Considered and rejected

- A rule for hidden Tabs: refuse a command on a hidden Tab, or end a Run whose Tab is hidden mid-Run. The agent would have to keep its Tab in front, which it does not control while an action opens a tab.
- Telling the Tab's visibility from the page, through a script ayme puts there. A Session puts nothing into the page but through Playwright, and the page would still stall.
- Joining with Playwright's defaults. They also change the colour scheme the pages see and how the browser handles downloads, which belong to the developer's browser automation.

## Cost

- While a Session is connected, an app that reacts to being hidden does not react on a Tab the Session worked on.
- Turning focus emulation on can make a Tab the one the browser counts as most recently active. In a check on headless Chromium, a visible Tab alone in its own window moved to the front of the browser's tab list; a Tab hidden behind another in the same window did not. A Session works on the most recently active Tab when a command names none, so after a command that names a Tab in another window, the next command that names none can go to that Tab, though the developer never brought it forward.
- When a Session lets go of a Tab, by detaching or ending, Chromium turns focus emulation off there, also where another client, such as the developer's own Playwright, had turned it on. ayme cannot leave it on, because Chromium offers no way to read whether it already was. The page on that Tab then reads as unfocused.
