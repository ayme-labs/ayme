## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in `ayme-labs/ayme`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default triage label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses a single-context domain-doc layout. See `docs/agents/domain.md`.

Treat `CONTEXT.md` as the canonical domain glossary.

Before adding or renaming a term in `CONTEXT.md`, present the proposed wording to the user and wait for explicit approval.

### Architectural decisions

Canonical ADRs live under `docs/adr/`. Use them for long-lived architectural decisions and keep their rationale there.

Before creating or superseding an ADR, present the complete proposed ADR to the user and wait for explicit approval. Never infer ADR approval from general agreement with a plan.

A single approval covers the complete supersession operation. Mark the old ADR as `superseded by ADR-NNNN`, keep the replacement ADR accepted and explicit about which ADR it supersedes, and keep the old ADR rationale intact.

## Updating the Playwright Lite fork

`@ayme-dev/playwright-lite` is a Git dependency on `ayme-labs/playwright-lite`, pinned to the commit SHA of an `ayme-<date>` tag (ADR-0021). Pin only such tags; never a branch or `main` commit.

1. To pick up upstream changes, first produce a new tag by following `docs/fork/SYNC.md` in the fork. Read it from the latest `ayme-*` [tag](https://github.com/ayme-labs/playwright-lite/tags); the fork's `main` mirrors upstream and does not contain it.
2. Replace the old SHA with the new tag's SHA everywhere and reinstall: `git grep -l <old-sha> -- ':!pnpm-lock.yaml' | xargs perl -pi -e 's/<old-sha>/<new-sha>/g' && pnpm install`. This covers the three `package.json` files, `allowBuilds` in `pnpm-workspace.yaml`, the `README.md` ledger link, and `packages/webmcp/THIRD_PARTY_NOTICES.txt`. `git grep <old-sha>` must then find nothing. pnpm rewrites the lockfile unformatted, so run `pnpm exec prettier --write pnpm-lock.yaml`; the lockfile diff should be a few lines.
3. Run `pnpm check`. Review the upstream changelog for behaviour changes that affect POMs.

## Development environment

- Start a persistent Devbox shell and run all project commands inside it.
- If Devbox is unavailable, surface the environment blocker.
