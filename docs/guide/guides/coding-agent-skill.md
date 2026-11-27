# Coding agent skills

The skills ayme ships for your coding agent, and what each one is for.

Install one with the [`skills` CLI](https://github.com/vercel-labs/skills), from your project's root:

```bash
npx skills add ayme-labs/ayme --skill ayme
```

Name the skill with `--skill`, once for each skill you want. Without it, the CLI also offers the skills this repository uses for its own development.

## `ayme`

Sets up ayme in your project: the agent follows the quickstart for your framework, exposes one of your existing Page Object Actions, and calls that action with the `ayme` command, beside its browser automation. After setup, it helps you design Page Object Models and use the page's tools. It tells the agent how to connect the `ayme` command and Playwright CLI, Playwright MCP or agent-browser to one browser, as [Connect an agent](connect-an-agent.md) shows. [Read the `ayme` skill](https://github.com/ayme-labs/ayme/blob/main/skills/ayme/SKILL.md); its [onboarding steps](https://github.com/ayme-labs/ayme/blob/main/skills/ayme/references/onboarding.md) list exactly what setup does.

## `ayme-capture`

Records a flow while you drive your app, then turns the recording into Playwright page objects and a test that replays the flow. It can also write an automation that does the flow with new data and asks you before each step that can't be undone. To make those page objects ayme tools too, use the `ayme` skill. [ayme capture](recorder.md) covers recording itself. [Read the `ayme-capture` skill](https://github.com/ayme-labs/ayme/blob/main/skills/ayme-capture/SKILL.md).

## `product-surfaces`

Lists who uses your product and where they meet it, such as a UI, an API, a CLI or emails, in `ayme/product-surfaces/`. It also reviews a branch or a pull request by what each of those users will notice, with before and after views. It works with or without ayme. [Read the `product-surfaces` skill](https://github.com/ayme-labs/ayme/blob/main/skills/product-surfaces/SKILL.md).

## `ayme/CONVENTIONS.md`

What you settled for how ayme and its skills work in your repository. Each skill reads it first, and it overrides the skill's defaults. The opening part holds for every skill, and each skill has a section of its own, `ayme`, `Recorder` or `Product surfaces`, where it writes what you settle for later runs. It never holds credentials or real data. [The `ayme` folder](ayme-folder.md) lists what else the folder holds.
