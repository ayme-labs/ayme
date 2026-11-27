---
status: accepted
supersedes: ADR-0051, ADR-0055, ADR-0066
---

# A coding agent reaches Page Objects only through a Session, and a page that ships ayme only through WebMCP

## Why

A coding agent had two routes to a project's Page Objects. In the first, the page ran them, either because the app shipped ayme or because `ayme mcp` built them and served them into the page. The page then paired with the agent's ayme MCP server over the Agent Connection, and so did the app's own Node processes, as App Processes. In the second, a Session runs them in Node beside the developer's browser automation (ADR-0069).

The first route ran an action on ayme's reimplementation of Playwright, not on the Playwright the tests use. It put a second MCP server beside the browser automation, and it kept a pairing protocol, a page client, a served build and a script put into every page in step with the runtime. With both routes, every agent feature had two ways to be set up, documented and tested.

## Decision

- A coding agent reaches a project's Page Objects only through a Session, which it drives with the `ayme` command beside its own browser automation.
- ayme adds to that browser automation and does not compete with it. A Session offers the project's Page Object Tools and its read of the Page Object Tree, and none of ayme's own browser driving: no Browser Tools, no read of the Structural Page State, no Goal Loop and no Custom Tools.
- A page that ships ayme is reached only through WebMCP publication, by an agent that runs in the page and has no browser automation of its own. WebMCP publication stays experimental.
- A page that ships ayme is not a Session, and the `ayme` commands do not reach the ayme inside it. A Session's browser can show such a page: the page's own runtime and the Session are then two Hosts, each with its own Page Objects and Page Object Ids.
- There is no Agent Connection and there are no App Processes: an app's Node processes offer nothing to an agent. `ayme mcp` reaches no page; it only shows a Session's Inspector in an Agent App's chat (ADR-0072).
- For a page that ships ayme, the Inspector is the panel in the page. A Session's Inspector is a window of its own.

## Considered and rejected

- Keeping the Agent Connection for a page that ships ayme, beside the Session. Every agent feature would still have two routes, and a coding agent would still run that page's Page Objects on ayme's reimplementation of Playwright.
- Letting the `ayme` commands reach the ayme inside a page that ships it. A command would then reach Page Objects run by either of two Hosts, with Page Object Ids good only with the one that gave them.
- Browser Tools or Custom Tools in a Session. The developer's browser automation already drives the browser, and an agent that sees two ways to click uses them unevenly.
- Keeping App Processes by another route. Nothing but Peeks used them, and Peeks reach no agent (ADR-0076). They can come back when something needs them.

## Cost

- An agent that reached a page through `ayme mcp` needs a Session or, if it runs in the page, WebMCP publication.
- State held only by the app's server reaches no agent.
- A coding agent whose only browser automation was ayme has to add one.
