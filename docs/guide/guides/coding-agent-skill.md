# Coding agent skill

How to let a coding agent set up Ayme in your project with the `ayme` skill, and what it does.

## Install the skill

Copy this request into your coding agent:

> Install the `ayme` skill from https://github.com/ayme-labs/ayme/tree/main/skills/ayme into this project's skill directory, including its references. Then use it to set up Ayme here.

The skill is a `SKILL.md` with two references, onboarding and browser setup; keep the references directory when you install it.

## What it does

The agent follows the quickstart for your framework, exposes one of your existing Page Object Actions instead of writing a new one, connects itself to the page through the WebMCP local relay and calls that action. It then reports what it changed and what happened on the page. The [skill's onboarding steps](../../../skills/ayme/references/onboarding.md) list exactly what it does.
