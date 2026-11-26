---
name: product-surfaces
description: List a product's consumers and the surfaces where they meet it in `ayme/product-surfaces/`, keep that list current, or review a set of changes by the surfaces they change and what each consumer will notice, with before and after evidence from the running product.
---

# Product surfaces

Look at a product from the outside: who consumes it, where they meet it, and what a change looks
like from there.

Read `ayme/CONVENTIONS.md` first, when it exists: what the user settled for how ayme and its
skills work in this repository. Read its opening part, which holds for every skill, and its
`Product surfaces` section, and follow a line that points to another file. It overrides this skill's
defaults. When the user settles something for every later run, write it under `Product surfaces`,
creating the file when it is missing: never credentials or real data.

## Words

**Product**:
What the user's team builds and ships. It can span several repositories.

**Consumer**:
A person, an agent or another piece of software that comes to the product with a goal and meets it
on a surface. A consumer would notice a change on that surface without reading the code.

**Surface**:
A place where a consumer meets the product: something they call, run, read or receive. One surface
per interface the consumer relies on, such as a UI, an API, a CLI, each message channel, a file
format or a set of docs. An interface is one specific thing the product exposes: two separate apps
in a browser are two interfaces. Group by interface alone: places that share an interface are one
surface, whatever their consumers, entry points or features. A third party's interface is a surface
of its own when consumers meet it as a step in a user flow the product owns, a change to the product
can change what they do there, and no surface of the product already covers that step.

**Source**:
A file or folder the repository tracks, or a URL outside it, that shows a consumer or a surface
exists. Every entry of the list names its sources, and the check verifies the paths.

**The list**:
`ayme/product-surfaces/surfaces.ts`, the product's confirmed consumers and surfaces.

## What to read

- To write the list for a product that has none, or to add, remove or reshape an entry, read
  [The list](references/list.md).
- To review a commit range, a branch or a pull request by the surfaces it changes, read
  [Review](references/review.md).
- To show a reviewed change running, before and after, read [Evidence](references/evidence.md).
