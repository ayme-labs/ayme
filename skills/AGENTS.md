# Public agent skills

This directory contains consumer-facing agent skills distributed from this
repository. Each skill is self-contained under `skills/<name>/` and is not an
instruction source for work on this monorepo, except `product-surfaces`, which
this repository also uses on its own pull requests.

Keep setup and API detail in the consumer docs, `docs/guide/`, and link to it. A change to a skill's
behavior uses the `skills` commit scope.

`ayme` and `ayme-capture` are about integrating and using ayme.
`product-surfaces` works in a project with or without ayme, and uses ayme
where the project has it.

`skills/shared/` is not a skill: it holds references the skills about Page
Objects ship; [`scripts/check-docs.mjs`](../scripts/check-docs.mjs) names the
skills that ship none. A skill can also ship a copy of a guide page from `docs/guide/`. Edit the source,
then run `pnpm skills:sync` to update the copies;
[`scripts/check-docs.mjs`](../scripts/check-docs.mjs) lists the guide pages
copied and fails on a copy that differs.
