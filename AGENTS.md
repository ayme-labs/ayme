## Repository map

- `packages/`: the Ayme WebMCP product. Each package README owns its API and setup.
- `skills/`: skills shipped to consumers for integrating Ayme into their own project. Read [skills/AGENTS.md](skills/AGENTS.md) before editing one.
- `apps/example-vue/`: the hosted playground where visitors try Ayme before integrating it. A visitor installs only the local relay MCP server. Read [its README](apps/example-vue/README.md) before changing the app.

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

## Development environment

- Start a persistent Devbox shell and run all project commands inside it.
- If Devbox is unavailable, surface the environment blocker.
