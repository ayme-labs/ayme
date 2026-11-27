---
status: accepted
---

# A project's Page Objects run in Node, in a Session beside the developer's browser automation

## Why

Page Objects are written for Playwright tests. For a coding agent they ran inside the page, on ayme's own reimplementation of Playwright, so an action could behave differently from the test it came from. To get them into the page, either the app shipped ayme, or `ayme mcp` built them and served them in through the browser automation. Either way the agent needed ayme's MCP server beside the browser automation it already used: Playwright CLI, Playwright MCP or agent-browser.

## Decision

A coding agent reaches a project's Page Objects through a Session: one running ayme connected to one browser.

- The Session runs the project's Page Objects in Node, on the project's own Playwright, against the browser the developer's browser automation drives. It is the Host of each Tab it works on. Nothing of ayme has to be in the app.
- The agent reaches the Session through the `ayme` commands, which it runs beside its browser automation. The automation keeps doing everything else. A developer reaches the Session through the Inspector.
- The Session lives in a process of its own, so that what it holds lasts from one command to the next: its browser, its Page Objects, its Page Object Ids and the Run under way on each Tab.
- A Session always has a browser, which ayme either starts or joins, and it ends when that browser goes away. ayme closes only a browser it started.

Later ADRs build on this one: a Session is the only way a coding agent reaches Page Objects (ADR-0074), it changes one setting in a browser it joins (ADR-0071), it never answers a dialog (ADR-0073), and one token admits its Inspector (ADR-0072).

## Considered and rejected

- Keep running Page Objects in the page, built and served by `ayme mcp` (ADR-0051) and paired over the Agent Connection (ADR-0066). An action ran on ayme's reimplementation instead of on Playwright, the page needed ayme's runtime put into it, and the agent needed a second MCP server.
- Offer the Session's Page Object Tools as MCP tools. A spike ran the Formbricks eval with each of the three browser automations: with a plain `ayme` command beside it, each finished the missions more cheaply than with `ayme mcp`. An agent that drives its browser from the command line needs no second protocol for ayme.
- A command that joins the browser and builds the Page Objects again each time it runs, with no process between commands. Every command would pay for the join and the build, and no command could rely on what an earlier one was told, such as a Page Object Id, or wait for a Run another Caller started.
- ayme driving a browser of its own for the agent. The developer's browser automation already drives one, and ayme adds to it rather than replacing it (ADR-0074).

## Cost

- The developer's browser automation and ayme have to be connected to one browser: one more step to set up, and it differs between automations.
- A Session is a process that keeps running until it is closed or its browser goes away.
- The project's Page Objects are built for Node, beside any build that puts them in the app.
- A browser ayme starts serves the DevTools protocol on the loopback address without authentication, as any browser started for automation does, so any process on the machine can drive it. It has to: the developer's browser automation connects to it that way.
