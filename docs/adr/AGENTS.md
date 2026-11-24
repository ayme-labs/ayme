# Architecture decision records

[README.md](README.md) lists the ADRs in force. `pnpm adr:index` writes it, and `pnpm docs:check` fails when it is out of date. Run it after you add, retire or retitle an ADR.

- Write an ADR only for a decision that is costly to reverse, cannot be read from the code, and had a real alternative. Anything else is a code comment, a test or the guide.
- An ADR holds the decision, the reason, the options rejected and the consequences, and nothing the code or the guide already says: no API names, file counts, versions or migration steps. Those go stale, and the code and the guide own them.
- Name things by their term in [GLOSSARY.md](../../GLOSSARY.md), so a reader finds one meaning.
- To change a decision, write a new ADR that replaces the old one whole. Set the old one's front matter to `status: superseded by ADR-NNNN`, the new one's to `supersedes: ADR-NNNN`, and `git mv` the old one to `retired/` with its text unchanged. A reader then finds only decisions in force outside `retired/`. `docs:check` fails on a superseded ADR outside `retired/`.
- Present the complete ADR to the user and wait for explicit approval. Never infer approval from agreement with a plan. One approval covers the replacement: the new ADR, the old one's status and its move.
- An ADR's number and file name never change, so links to it hold. Point to a retired ADR by its path in `retired/`.
