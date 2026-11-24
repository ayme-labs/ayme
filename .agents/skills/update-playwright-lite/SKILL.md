---
name: update-playwright-lite
description: >
  Repin ayme's Playwright Lite fork (`@ayme-dev/playwright-lite`, from
  ayme-labs/playwright-lite) to a new `ayme-<date>` tag, and decide whether a
  Playwright Lite change belongs upstream or in the fork. Use when picking up
  upstream Playwright Lite changes, when ayme needs something Lite lacks, or
  before changing the fork.
---

# Updating the Playwright Lite fork

`@ayme-dev/playwright-lite` is a Git dependency on the fork
[ayme-labs/playwright-lite](https://github.com/ayme-labs/playwright-lite). The
fork's `main` mirrors upstream Playwright Lite
([enekesabel/playwright-lite](https://github.com/enekesabel/playwright-lite)),
and each sync publishes an `ayme-<date>` tag: upstream plus the fork's patch
queue. [ADR-0021](../../../docs/adr/0021-pin-playwright-lite-to-immutable-fork-tags.md)
records why ayme pins tags.

## What goes into the fork

- Send every fix that makes Lite behave as Playwright does to upstream Playwright Lite, whether you found the difference there or in the fork: a difference from Playwright is a Lite bug, not something ayme alone needs.
- Split each fork change into its upstream part and its ayme part, and keep only the ayme part in the fork's patch queue: every sync rebases that queue onto upstream, so each patch costs work on every sync.
- Build behaviour ayme needs that differs from Playwright's in ayme, on top of Lite, and keep Lite behaving as Playwright does: a Page Object written for Playwright tests runs on Lite, for the APIs Lite supports, only while it does.

## Pinning

Pin only the commit SHA of an `ayme-<date>` tag, never a branch or a `main`
commit: a sync rebases the fork's patch queue, so a commit taken from a branch
can disappear, while the fork's ruleset keeps `ayme-*` tags immutable
(ADR-0021).

## Steps

1. **Make the new tag.** Follow `SYNC.md` in the fork's `docs/fork/` folder.
   Read it from the latest `ayme-*`
   [tag](https://github.com/ayme-labs/playwright-lite/tags): the fork's `main`
   mirrors upstream and does not hold it. Done when the new `ayme-<date>` tag
   exists and you have its commit SHA.
2. **Replace the old SHA and reinstall.**

   ```sh
   git grep -l <old-sha> -- ':!pnpm-lock.yaml' | xargs perl -pi -e 's/<old-sha>/<new-sha>/g'
   pnpm install
   pnpm exec prettier --write pnpm-lock.yaml
   ```

   The first command rewrites the four `package.json` files, `allowBuilds` in
   [pnpm-workspace.yaml](../../../pnpm-workspace.yaml), the ledger link in
   [Playwright in the browser](../../../docs/guide/reference/playwright-in-the-browser.md)
   and [THIRD_PARTY_NOTICES.txt](../../../packages/ayme/THIRD_PARTY_NOTICES.txt).
   pnpm writes the lockfile unformatted, so Prettier runs after it. Done when
   `git grep <old-sha>` finds nothing and the lockfile diff is a few lines.

3. **Copy the new InjectedScript.** Run
   `pnpm --filter @ayme-dev/ayme sync:injected`. It copies the new tag's
   generated InjectedScript into `packages/ayme/build/generated/`, where the
   in-page module's build reads it, and prints its size and SHA-256. Review the
   artifact's diff, then set `expectedBytes` and `expectedSha256` in
   [pinnedAriaSnapshot.ts](../../../packages/ayme/build/pinnedAriaSnapshot.ts)
   to the printed values. Done when both values match the printed ones.
4. **Read the upstream changelog** between the old tag and the new one for
   behaviour changes that affect Page Objects, then open the pull request. CI
   checks the affected packages.
