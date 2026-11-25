# Architecture decision records

Write, change and retire an ADR by the [`adr` skill](https://github.com/enekesabel/dev-env/blob/main/skills/adr/SKILL.md): it holds every ADR rule that is not specific to this repository, so this file adds only what is.

- [README.md](README.md) lists the ADRs in force. `pnpm adr:index` writes it, and `pnpm docs:check` fails when it is out of date, so run it after you add, retire or retitle an ADR.
- [`scripts/adr-index.mjs`](../../scripts/adr-index.mjs) checks that each ADR is in the folder its status calls for.
