# Probe for #243

Minimal reproductions behind `../../unified-ayme-api.md`. Run `./run-probe.sh` from this directory inside the Devbox shell, after `pnpm install` and `pnpm turbo run build --filter=@ayme-dev/ayme --filter=@ayme-dev/unplugin-ayme` at the repository root.

- `typing/`: type-checks a combined `ayme` (today's decorator plus the internal helper's operations) in legacy and standard decorator modes.
- `shake/`: bundles a decorator-only consumer against today's main entry and against a combined `ayme`, and reports what each bundle keeps.
- `compiler/`: runs the build integration's manifest derivation on aliased, namespaced and combined-object markers.
