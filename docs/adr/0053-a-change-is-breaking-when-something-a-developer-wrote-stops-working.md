---
status: accepted
---

# A change is breaking when something a developer wrote stops working

## Why

Ayme has two readers. A developer writes code and configuration against it. An agent reads the tool list, descriptions and results while it works. We had no rule for which changes count as breaking, and adding Page Object Tools beside a developer's browser automation changes both sides at once.

## Decision

A change is breaking when something a developer wrote stops working or behaves differently. That covers an export, a decorator, an option, a CLI flag, and the input a tool takes when application code calls it. The commit is marked breaking, so the changelog shows the old and the new form.

What an agent reads is not a contract: which tools a channel lists, their descriptions, and the result format an agent channel shows. An agent keeps none of it between sessions. It learns it from the skill, and the skill changes in the same release. These changes are not marked breaking. Where a developer would still notice one, such as a shorter default tool list, the changelog says so in one line.

## Considered and rejected

- Everything an agent can observe is breaking. Most releases would carry the mark for changes no developer has to act on, and developers would learn to ignore it.
- Only type changes of exports are breaking. An option or flag that changes behaviour breaks a setup just as much.

## Cost

A judgement call where the two meet. When application code reads a result through the same call an agent makes, that result belongs to the developer. Changing it is breaking even if the change was made for the agent.
