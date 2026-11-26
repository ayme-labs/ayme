---
status: accepted
---

# A project's Page Objects run in Node, in a Session beside the developer's browser automation

## Why

Page Objects are written for Playwright tests, but for a coding agent they ran inside the page, on ayme's own reimplementation of Playwright, so an action could behave differently from the test it came from. To get them there, either the app shipped ayme, or `ayme mcp` built them and served them into the page through the browser automation's init script, and the page then paired with an MCP server over the Agent Connection. An agent that already drove the browser with Playwright CLI, Playwright MCP or agent-browser needed that second MCP server to reach a Page Object Tool.

A spike measured the alternative on the Formbricks eval: with a plain `ayme` command beside it, each of the three browser automations finished the missions more cheaply than with `ayme mcp`.

## Decision

A coding agent reaches a project's Page Objects through a Session: one running ayme connected to one browser.

- The Session runs the project's Page Objects in Node, with the project's own Playwright, as the Host of each Tab it works on, against the browser the developer's browser automation drives. Nothing of ayme has to be in the app.
- An agent reaches the Session through the `ayme` commands, which it runs beside its browser automation. The automation keeps doing everything else: snapshots, clicks outside Page Objects, navigation and answering dialogs. A developer reaches the Session through the Inspector.
- The Session lives in a process of its own that the commands talk to, so that what it holds lasts from one command to the next: its browser, its Page Objects, its Page Object Ids and the Run under way on each Tab.
- A Session always has a browser. It starts with one, which `ayme open` starts or `ayme attach` joins, and it ends when that browser goes away. ayme closes only a browser it started.
- A page that ships ayme is not a Session. An agent reaches it through WebMCP.

## Considered and rejected

- Keep running Page Objects in the page, built and served by `ayme mcp` (ADR-0051) and paired over the Agent Connection (ADR-0066). An action ran on ayme's reimplementation instead of on Playwright, the page needed ayme's runtime put into it, and the agent needed a second MCP server beside its browser automation.
- Offer the Session's Page Object Tools as MCP tools. On the eval, every browser automation did the missions more cheaply with plain commands, and an agent that drives its browser from the command line needs no second protocol for it.
- A command that joins the browser and builds the Page Objects again each time it runs, with no process between commands. Every command would pay for the join and the build, and no command could rely on what an earlier one was told, such as a Page Object Id, or wait for a Run another Caller started.
- ayme driving a browser of its own for the agent. The developer's browser automation already does that, and ADR-0055 leaves it to that automation.

## Cost

- The developer's browser automation and ayme have to be connected to one browser: one more step to set up, which differs between automations.
- A Session is a process that keeps running until it is closed or its browser goes away.
- The project's Page Objects are built for Node, beside any build that puts them in the app.
