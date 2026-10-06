# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- `GLOSSARY.md` at the repo root, or
- `GLOSSARY-MAP.md` at the repo root if it exists
- `docs/adr/` for decisions touching the area being explored

If these files do not exist, proceed silently. Do not suggest creating them upfront. The domain-modeling skill creates them when terms or decisions actually get resolved.

## File structure

This is a single-context repository:

```text
/
├── GLOSSARY.md
├── docs/adr/
└── src/
```

## Use the glossary's vocabulary

When output names a domain concept, use the term defined in `GLOSSARY.md`. If the concept is missing, treat that as a domain-modeling signal.

## Flag ADR conflicts

If output contradicts an existing ADR, surface that explicitly rather than silently overriding it.
