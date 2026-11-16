# Public agent skills

This directory contains consumer-facing agent skills distributed from this
repository. Each skill is self-contained under `skills/<name>/` and is not an
instruction source for work on this monorepo.

Keep setup and API detail in the consumer docs, `docs/guide/`, and link to it. A change to a skill's
behavior uses the `skills` commit scope.

`skills/shared/` is not a skill: it holds references every skill ships. A
skill can also ship a copy of a guide page from `docs/guide/`. Edit the source,
then run `pnpm skills:sync` to update the copies;
[`scripts/check-docs.mjs`](../scripts/check-docs.mjs) lists the guide pages
copied and fails on a copy that differs.
