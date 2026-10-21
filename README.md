# Ayme

Ayme turns the Page Object Models from your Playwright tests into tools that coding agents and your own app can call in the running page.

![The Ayme playground with the Inspector open on its Model lens](docs/guide/images/inspector-model.png)

<!--
Reserved for the Goal Loop clip, added once it is recorded.
-->

## Compared with Playwright

The same task on [Formbricks](https://github.com/formbricks/formbricks), a real survey app, done by Claude Code through six browser interfaces: rename a survey, change its question, save it and confirm the summary page. Three runs each; every cell is the median, with the lowest and highest in parentheses.

| Browser interface                                      | Passes | Wall time            | Tool calls   | Tokens, input and output | Tokens, all                 | Cost                                  |
| ------------------------------------------------------ | ------ | -------------------- | ------------ | ------------------------ | --------------------------- | ------------------------------------- |
| Playwright MCP                                         | 3 of 3 | 44.6 s (35.3 – 51.1) | 17 (14 – 18) | 2,011 (1,619 – 2,266)    | 377,084 (328,139 – 378,674) | $0.149 ($0.144 – $0.150)              |
| Playwright CLI, with its skill                         | 3 of 3 | 41.9 s (34.4 – 42.0) | 13 (10 – 14) | 1,260 (1,057 – 1,857)    | 465,080 (329,642 – 468,394) | $0.160 ($0.131 – $0.171)              |
| Ayme's MCP server                                      | 3 of 3 | 21.9 s (20.4 – 22.0) | 6 (6 – 6)    | 842 (803 – 1,076)        | 134,304 (134,079 – 134,607) | $0.060 ($0.060 – $0.063)              |
| Ayme's MCP server, with the Goal Loop                  | 3 of 3 | 22.8 s (21.9 – 23.7) | 5 (4 – 6)    | 957 (844 – 1,059)        | 120,314 (98,319 – 146,114)  | $0.072 ($0.065 – $0.079), over 2 runs |
| Ayme's MCP server, no page objects                     | 3 of 3 | 25.8 s (24.0 – 26.3) | 9 (8 – 9)    | 1,095 (1,038 – 1,198)    | 211,305 (211,282 – 220,183) | $0.092 ($0.091 – $0.109)              |
| Ayme's MCP server, no page objects, with the Goal Loop | 3 of 3 | 21.9 s (20.6 – 25.4) | 4 (4 – 6)    | 846 (822 – 1,096)        | 112,959 (101,653 – 157,777) | $0.079 ($0.055 – $0.095)              |

Measured on 2026-10-15 on a GitHub-hosted Ubuntu runner, on `main` at [`1f300f8f`](https://github.com/ayme-labs/ayme/commit/1f300f8f0a2188b07027532217c34c9e9b944492), with Claude Code 2.1.281 on Sonnet (`claude-sonnet-5`) at medium effort, on Formbricks at the lab overlay [`211ad70`](https://github.com/ayme-labs/formbricks/tree/211ad704de30aabf96c059cc1cf00391d5b63a27). Time, tokens, cost and calls are the task's alone: each run first gets the agent ready in a message of its own, which is not counted. Tokens, input and output, are the agent's own input and output tokens. Tokens, all, add the reads and writes of its prompt cache, which carries the page state and tool results from turn to turn. The cost is Claude Code's own figure, plus the Goal Loop's own model cost where it ran; OpenRouter still has no record of two of one run's calls, so that row rests on two runs. "No page objects" is the same app with its page objects switched off, so the agent and the Goal Loop work with Ayme's Browser Tools alone. The full results, with every version a rerun must match, are in [the dated summary](apps/eval-formbricks/summaries/2026-10-15-hosted-runner/summary.md); [a longer mission](apps/eval-formbricks/summaries/2026-10-15-hosted-runner-sign-in-create-and-revise-survey/summary.md), which signs in, creates a survey and revises it, ran on the same runner. The earlier results from a Mac are in [the 2026-10-06 summary](apps/eval-formbricks/summaries/2026-10-06/summary.md), and [the eval](apps/eval-formbricks/README.md) reruns them.

## What you can do with it

- **Drive your app from your coding agent.** Claude Code, or any MCP client, calls your Page Object Actions on the page you have open, reads what is on the page and acts on it, while you develop.
- **Hand the page a goal.** An agent says "invite Ada as an admin", and the Goal Loop works the page toward it in small steps, each one judged by Jev, TypeSafe's decision model, instead of the agent's own LLM.
- **Build an in-app assistant.** An onboarding assistant inside your app gets your Page Object Actions and the page state as its tools, so it works the page while the user watches. A checklist's "Show me how" button can run the same actions directly. See [Build an in-app assistant](docs/guide/guides/in-app-assistant.md).

## How it works

You mark a Page Object Model and the actions to expose. The build plugin compiles them into your app, and when the app runs, Ayme offers three kinds of tools to agents: to a coding agent through Ayme's MCP server, and to agents in the browser through WebMCP, the browser's way of offering tools on a page:

- **Page Object Tools**: your marked actions, such as `ProjectsPage.createProject`.
- **Browser Tools**: built-in operations on the page, such as `click` and `fill`, aimed at what `snapshot` shows.
- **Custom Tools**: operations of your own on one element, such as highlighting it for the user.

While you develop, a coding agent also gets **Peek Tools**: they read app state the page does not show, such as a store or what your server holds, from the page and from your app's own Node processes. WebMCP never publishes them. See [`ayme.peek`](docs/guide/reference/ayme.md#aymepeek).

The **Goal Loop** runs on top of them: `goal` takes a goal in natural language and lets Jev pick one operation per step until the goal is met or it needs the agent. Jev is reached through a **Decision Endpoint**, one route in your backend, or in your dev server while you develop, that adds your TypeSafe or OpenRouter key.

The **Inspector** is an in-page panel that shows your Page Objects, what the agent sees and every tool, and runs them by hand.

![The Inspector's Tools lens listing Page Object Tools and Browser Tools](docs/guide/images/inspector-tools.png)

## Install

```sh
npm install @ayme-dev/ayme @ayme-dev/vue # or react, svelte
npm install -D @ayme-dev/unplugin-ayme @playwright/test
```

On Angular, `ng add @ayme-dev/angular` sets everything up. Then mark a Page Object Model:

```ts
import { ayme } from "@ayme-dev/ayme";
import type { Page } from "@playwright/test";

@ayme
export class ProjectsPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  @ayme.action
  async createProject(name: string) {
    await this.page.getByRole("button", { name: "New project" }).click();
    await this.page.getByRole("textbox", { name: "Project name" }).fill(name);
    await this.page.getByRole("button", { name: "Create" }).click();
  }
}
```

The quickstart for [Vue](docs/guide/start/quickstart-vue.md), [React](docs/guide/start/quickstart-react.md), [Svelte](docs/guide/start/quickstart-svelte.md) or [Angular](docs/guide/start/quickstart-angular.md) takes it from there to your agent calling `ProjectsPage.createProject`. A coding agent can do the setup for you with the [`ayme` skill](docs/guide/guides/coding-agent-skill.md).

## Documentation

Read the docs at [ayme-labs.github.io/ayme/docs](https://ayme-labs.github.io/ayme/docs/), or here on GitHub, starting from the [documentation index](docs/guide/README.md). The index lists every page in reading order: what Ayme is, install and the quickstarts first, then the guides, one page per framework, the reference and troubleshooting. GitHub renders the pages in place, and the links between them work.

## Your data stays with you

Ayme runs entirely in your app: in its page, and in its own Node processes where you start it. It has no backend and no account, and it sends nothing to Ayme. Your app's content leaves it in three ways, all set up by you: a coding agent you connect reads the page and your app's Peeks through Ayme's MCP server, which runs on your machine; with WebMCP publication on, an in-browser agent calls your Page Object, Browser and Custom Tools (never Peeks); and each Goal Loop step goes from your own Decision Endpoint, with your key, to the model provider you chose.

## License

Ayme is [Fair Source](https://fair.io), licensed under the
[Functional Source License, Version 1.1, ALv2 Future License](LICENSE)
(FSL-1.1-ALv2). You may use, modify, and redistribute it for any purpose other
than a Competing Use, including in your own applications and products. Each
version becomes available under the Apache License 2.0 two years after its
release.

Bundled third-party code keeps its original license; see each package's
`THIRD_PARTY_NOTICES.txt`.
