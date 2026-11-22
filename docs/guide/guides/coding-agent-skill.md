# Coding agent skills

The three skills ayme ships for your coding agent: what each is for, how to install it, and what it writes into your project.

| Skill                                   | Use it to                                                                                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ayme`](#ayme)                         | set up ayme in your project, design Page Object Models for it, and call your page's tools through ayme's MCP server                           |
| [`ayme-recorder`](#ayme-recorder)       | record a flow while you drive your app, then turn it into Playwright page objects and a test, or into an automation of the flow with new data |
| [`product-surfaces`](#product-surfaces) | list who uses your product and where they meet it, and review a change by what each of them will notice                                       |

Each skill is a `SKILL.md` with the directories beside it. Keep those directories when you install it: the `SKILL.md` links to them. Install several by naming each in the same request. All three read [`.ayme/CONVENTIONS.md`](#aymeconventionsmd), where they keep what you settle for your repository.

## `ayme`

Sets up ayme in your project and works with your page through it: wiring your framework, exposing Page Object Actions, designing Page Object Models, connecting to the page with `ayme_connect`, using the page's tools and adding Peeks.

Copy this request into your coding agent:

> Install the `ayme` skill from https://github.com/ayme-labs/ayme/tree/main/skills/ayme into this project's skill directory, including its `references` directory. Then use it to set up ayme here.

To set ayme up, the agent follows the quickstart for your framework, exposes one of your existing Page Object Actions instead of writing a new one, registers ayme's MCP server, connects to the page and calls that action. It then reports what it changed and what happened on the page. The [skill's onboarding steps](https://github.com/ayme-labs/ayme/blob/main/skills/ayme/references/onboarding.md) list exactly what it does.

What it writes into your project:

- ayme's packages, and the framework wiring the quickstart describes.
- ayme's decorators on your Page Object Models, and new or restructured models when you ask for them.
- The registration of ayme's MCP server for your coding agent.
- Peeks, when you ask for one.
- The `ayme` section of `.ayme/CONVENTIONS.md`, when you settle something for every later run.

To record a flow you drive and turn it into page objects and a test, install `ayme-recorder` as well.

## `ayme-recorder`

Records a flow while you drive your app, and turns the recording into one of two results:

- a mirroring test: page objects and one Playwright test that replays the flow against your app;
- a production automation: a parameterised Playwright automation that does the flow with new data, such as data entry that ends in a real submission, with a replay test that answers from the recording, so its waits and locators get fixed without touching your real backend. Before each step that can't be undone, the automation asks you to confirm, and only you approve it.

Copy this request into your coding agent:

> Install the `ayme-recorder` skill from https://github.com/ayme-labs/ayme/tree/main/skills/ayme-recorder into this project's skill directory, including its `references`, `playbooks` and `assets` directories. Then use it to record a flow I drive and write a Playwright test for it.

The agent starts the recorder with `npx @ayme-dev/cli@latest codegen <url>`, or with the project's own `@ayme-dev/cli` when `package.json` pins it. A recorder window opens on your app: you perform the flow and press Finish. The agent then reads the recording, proposes the page objects and the test or automation, and writes them once you agree.

What it writes into your project:

- The recording, under `.ayme/recordings/`, written by the recorder.
- Playwright page objects.
- For a mirroring test: the test.
- For a production automation: page objects with no ayme decorators, the flow function, the confirm step, the entry script you run, the replay test with a copy of the skill's `assets/replay.ts`, and the recorded parameters in `.ayme/params/`. Real runs add their parameter files and traces where you agree with the agent, and the reference layout keeps a saved login in `.ayme/auth.json`. These hold real data.
- The `Recorder` section of `.ayme/CONVENTIONS.md`, for what holds for every flow, and notes beside a flow's code for what holds for one site or flow.

When the page objects should also become ayme tools, install the `ayme` skill as well.

## `product-surfaces`

Looks at your product from the outside. It lists the product's consumers, meaning the people, agents and software that use it, and the surfaces where they meet it, such as a UI, an API, a CLI, emails or docs. It keeps that list current, and it reviews a commit range, a branch or a pull request by the surfaces the change touches and what each consumer will notice, with before and after views. On request, it captures evidence of the change from the running product in both states. It works in a project with or without ayme; with ayme, it drives a UI through your Page Object Tools.

Copy this request into your coding agent:

> Install the `product-surfaces` skill from https://github.com/ayme-labs/ayme/tree/main/skills/product-surfaces into this project's skill directory, including its `references` and `assets` directories. Then use it to list this product's consumers and surfaces.

What it writes into your project:

- `.ayme/product-surfaces/surfaces.ts`, the list, once you confirm it, with `types.ts`, `check.mjs` and `package.json` copied beside it from the skill's assets. `node .ayme/product-surfaces/check.mjs` checks the list, and needs Node 22.18 or newer.
- Once you agree, a paragraph in your agent instructions, such as `AGENTS.md` or `CLAUDE.md`, that asks agents to keep the list current.
- Once you agree, `.ayme/**/*.ts` in the `include` of a `tsconfig.json`, when your type check doesn't cover the folder yet.
- How to start your product, in the opening part of `.ayme/CONVENTIONS.md`, when it captures evidence and the repository doesn't say it yet.
- The `Product surfaces` section of `.ayme/CONVENTIONS.md`, when you settle something for every later run.

A review changes nothing in the repository.

## `.ayme/CONVENTIONS.md`

What you settled for how ayme and its skills work in your repository. Each skill reads it before it starts, and it overrides the skill's defaults. A skill creates it when you first settle something for every later run.

```markdown
What holds for every skill, such as how to start the product.

## ayme

What holds for the ayme skill.

## Recorder

What holds for the recorder skill, such as where parameter files and run traces go.

## Product surfaces

What holds for the product-surfaces skill.
```

The opening part holds for every skill. Each skill reads it and its own section, and writes what you settle for it to its own section; `product-surfaces` also adds how to start the product to the opening part. A line can point to another file instead of repeating it, and the skills follow it. The file never holds credentials or real data. You can edit it by hand.
