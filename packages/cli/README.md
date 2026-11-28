# ayme

`ayme` is the command of `@ayme-dev/cli`. It holds two products:

- **ayme inspect**: your coding agent calls your project's Page Object Tools beside the browser automation it already uses, and you watch and run them in the Inspector.
- **ayme capture**: you click through a flow in your app, it records every step and what each step changed, and your coding agent turns the recording into Playwright page objects and a test.

The [ayme documentation](https://github.com/ayme-labs/ayme/blob/main/docs/guide/README.md) has the detail. Coming from 0.3, read [Upgrade](https://github.com/ayme-labs/ayme/blob/main/docs/guide/upgrade.md) first.

## Install

From your project's folder:

```sh
npm install -D @ayme-dev/cli "@playwright/test@>=1.62 <1.65"
npx playwright install chromium
```

ayme runs on your project's own Playwright and brings no browser. Run it as `npx ayme`, from your project's folder. [Connect an agent](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/connect-an-agent.md#set-up-your-project) has the rest of the setup for Page Objects, and [ayme capture](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/recorder.md#before-you-start) the Playwright versions it records on.

Install the skills that teach your coding agent each product, as [Coding agent skills](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/coding-agent-skill.md) describes:

```sh
npx skills add ayme-labs/ayme --skill ayme
npx skills add ayme-labs/ayme --skill ayme-capture
```

To update, install `@ayme-dev/cli@latest`, with `@ayme-dev/ayme` at the same version if your project has it, and run the two `npx skills add` lines again. `npx ayme --version` prints the version you have.

## Page Objects for your coding agent

Your coding agent starts a Session: one running ayme connected to the browser its browser automation drives, such as Playwright CLI, Playwright MCP or agent-browser. The Session runs the Page Objects your project lists in `ayme/page-objects.ts`, in Node, on your project's Playwright. Nothing of ayme has to be in your app.

With the [quickstart](https://github.com/ayme-labs/ayme/blob/main/docs/guide/start/install.md)'s `ProjectsPage` listed in `ayme/page-objects.ts`, as [Set up your project](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/connect-an-agent.md#set-up-your-project) shows:

```sh
npx ayme open http://localhost:5173/
npx ayme page-objects
npx ayme call ProjectsPage.createProject --params '{"name": "Launch plan"}'
npx ayme close
```

`ayme open` starts Chromium and prints the address the browser automation attaches to; `ayme attach --cdp=<url>` joins a browser the automation opened instead. `ayme page-objects` prints the Page Objects on the screen, with the id of each one that has a root, `ayme call` runs one of their tools, and `ayme close` ends the Session. [Connect an agent](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/connect-an-agent.md) shows each browser automation, and `npx ayme --help` lists every command.

## The Inspector

`npx ayme inspect` prints the address of the Inspector on a Session, to open in any browser: the Page Objects and tools of the Session's Tab, to run by hand. Registered in your Agent App's MCP configuration, `ayme mcp` shows the same Inspector in the chat. See [Inspector](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/inspector.md#in-a-window-of-its-own).

## ayme capture

![A coding agent starts the Recorder; the flow is recorded with the app on the left and the Recorder on the right listing each step and what it changed; the agent then writes a page object and a test from the recording and runs it](https://raw.githubusercontent.com/ayme-labs/ayme/main/docs/cli/images/recorder-demo.gif)

### Record a flow

Run ayme capture from your project's folder and pass the address where the flow starts:

```sh
npx ayme capture http://localhost:3000
```

It opens the page in Chromium, with the Recorder beside it and a small toolbar on the page. Recording is off at first, so you can get the page into the state you want to start from, such as logged in. Then:

1. Press **Record** in the Recorder, or on the toolbar.
2. Walk through the flow in the app.
3. Press **Finish** to save the recording. The terminal prints its path as `Recording package: ...`.

![The Recorder during a recording: a page heading, the navigation, and each step with the changes it caused](https://raw.githubusercontent.com/ayme-labs/ayme/main/docs/cli/images/recorder-timeline.png)

The [ayme capture guide](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/recorder.md) covers the controls, a logged-in app, the files a recording saves, its trace, the warnings and the limits.

When the Recorder cannot fully record a step, it prints a line that starts with `Warning:` in the terminal and keeps recording. If you ran ayme capture yourself, pass the warning to your agent with the recording. The guide [lists the warnings](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/recorder.md#warnings).

### Turn a recording into page objects

The `ayme-capture` skill teaches your coding agent to read a recording and write page objects and a Playwright test from it. Install it as in [Install](#install), or copy this request into your coding agent:

> Install the `ayme-capture` skill from https://github.com/ayme-labs/ayme/tree/main/skills/ayme-capture into this project's skill directory, including its references, playbooks and assets.

Then hand it the recording you just saved, with the path the terminal printed as `Recording package:`:

> Turn the recording at `ayme/recordings/<recording-id>/package.yaml` into Playwright page objects and a test, with the `ayme-capture` skill.

The agent reads the recording, proposes the page objects and the test, and writes them once you agree. You can also ask the agent to record the flow itself, as the guide describes in [Hand a flow to your coding agent](https://github.com/ayme-labs/ayme/blob/main/docs/guide/guides/recorder.md#hand-a-flow-to-your-coding-agent).

### Compared with Playwright MCP

A coding agent wrote Playwright page objects and a passing test for the same flow in two ways:

- **ayme capture:** the flow was recorded once, and the agent worked from the recording with the Recorder's skill. The recording was made by a script that gave the steps as input events, not by a person.
- **Playwright MCP:** the agent got the flow as written steps and explored the pages itself.

|                | Time to a passing test | Mean | Runs with a failed test run | Cost                  |
| -------------- | ---------------------- | ---- | --------------------------- | --------------------- |
| ayme capture   | 47 s (44 – 56)         | 49 s | 0 of 5                      | $0.39 ($0.35 – $0.43) |
| Playwright MCP | 91 s (52 – 147)        | 91 s | 2 of 5                      | $0.41 ($0.33 – $0.46) |

Time and cost show the median of five runs, with the lowest and highest in parentheses. Every run ended with a passing test. The time ranges overlap by one run.

A failed test run is a run of the test that failed before its first pass; a command that started no test does not count. In one Recorder run, the test failed twice after that first pass, on a locator that matched two links, and the agent fixed it before the run ended. When each of the ten tests was run three more times afterwards, all ten passed 3 of 3.

The flow has nine steps on a GitHub repository page: through its pull requests, its releases and the Code menu.

**How it was measured**

- **When and where:** once, on 2026-11-23, on a Mac against live github.com. The runs went one at a time, the two sides alternating.
- **Agent:** Claude Code on Sonnet 5.5 (`claude-sonnet-5-5`) at medium effort.
- **Recorder:** `@ayme-dev/cli` built from commit [`acaa6d1f3`](https://github.com/ayme-labs/ayme/commit/acaa6d1f39d51686ca9269f9fd5b788b3ec5e400), with the `ayme-recorder` skill of the same commit, since renamed `ayme-capture`.
- **Time:** the agent's working time from the prompt to the first passing run of the test it wrote, without the wait for the one reply each run got to its plan.

The [measurement's write-up](https://github.com/ayme-labs/ayme/issues/1358#issuecomment-7098192006) has each run and the full method.

## License

[MIT](https://github.com/ayme-labs/ayme/blob/main/packages/cli/LICENSE), for all of ayme's code in this package, including the code it bundles from other ayme packages. Bundled third-party code keeps its original license; see `dist/THIRD_PARTY_NOTICES.txt` and, for the Inspector, `dist/inspector/THIRD_PARTY_NOTICES.txt` in the package. The ayme name and logos are not covered by the license; see [TRADEMARKS.md](https://github.com/ayme-labs/ayme/blob/main/packages/design-system/TRADEMARKS.md).
