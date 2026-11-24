# The list

The list lives in one folder of the repository:

```text
ayme/product-surfaces/
├── surfaces.ts    # the list: `consumers` and `surfaces`. People and agents edit this.
├── types.ts       # the contract, copied from this skill's assets
├── check.mjs      # the check, copied from this skill's assets
└── package.json   # copied too: makes Node load this folder as ES modules, whatever the project uses
```

```ts
// ayme/product-surfaces/surfaces.ts
import type { Consumers, Surfaces } from "./types";

export const consumers = {
  shopper: {
    name: "Shopper",
    who: "Someone buying from the store",
    goal: "Find a product and pay for it",
    sources: ["docs/personas.md"],
  },
} satisfies Consumers;

export const surfaces = {
  storefront: {
    name: "Storefront",
    what: "The web app at the store's address",
    consumers: {
      shopper: "Browses the catalogue, fills the cart and checks out",
    },
    sources: ["apps/storefront/src/routes", "docs/help/checkout.md"],
  },
  orderEmails: {
    name: "Order emails",
    what: "The emails the store sends about an order",
    consumers: {
      shopper: "Reads the confirmation and follows the tracking link",
    },
    sources: ["services/mailer/templates"],
  },
} satisfies Surfaces<keyof typeof consumers>;
```

- The file is data only: two exported constants and a type-only import, so the check and other
  tools can load it. Write the import specifier the project's module resolution accepts: `./types`,
  `./types.js` or `./types.ts`.
- `name` is the name people outside the code use. The key is the stable identifier.
- A surface's `consumers` gives each consumer that meets it one line: what they do there.
- `sources` are files or folders, as paths from the repository root, each chosen so that moving or
  deleting it means the entry needs another look. Give a folder for something spread over many
  files. Give a URL for what lives outside the repository, such as a third party's interface or
  another repository of the product.

## Write the list

For a product with no list yet. Start from the repositories the user names, or the current one.

1. List the consumers: who each is, and the goal they come with.
2. List the surfaces: what each is, which consumers meet it and what they do there.
3. Give every consumer and every surface its sources.
4. Turn what you are unsure of into questions for the user: a consumer you inferred, a surface you
   could not open, a split the user may see differently. They go into the conversation, not the
   file.
5. Show the consumers, the surfaces and the questions to the user, and discuss them until the user
   confirms the list. Their corrections come before anything else.
6. Save the confirmed list as `surfaces.ts`, and copy [types.ts](../assets/types.ts),
   [check.mjs](../assets/check.mjs) and [package.json](../assets/package.json) beside it,
   unchanged. When the product spans several
   repositories, the user picks the one that holds the list.
7. Run `node ayme/product-surfaces/check.mjs` and the project's type check, and fix what they
   report.
8. Propose the [setup](#setup) the repository lacks, and write each part once the user agrees.

The list is done when every consumer meets at least one surface, every surface names at least one
consumer, every place you found where a consumer meets the product belongs to a surface, and the
check passes.

## Keep the list current

When a change adds, removes or reshapes a consumer or a surface, or the user asks for an edit such
as a new name:

1. Propose the edit to the user, and edit `surfaces.ts` once they agree.
2. Run the check. A source it reports as no longer tracked was moved or deleted: find where it went,
   and ask whether the entry it stood for changed with it.

When the first line of `types.ts` or `check.mjs` names an older contract than this skill's copy,
offer to replace the copied files, and adapt `surfaces.ts` to the newer contract.

## Setup

Each part is proposed to the user and written once they agree. Skip a part that is already there.

- **Agent instructions.** Add this to the agent instructions of every repository of the product
  (`AGENTS.md`, `CLAUDE.md` or whichever the repository uses; when one only imports another, the
  file that holds the content), with the list's path:

  > The product's consumers and the surfaces where they meet it are listed in
  > `ayme/product-surfaces/surfaces.ts`. When a change adds, removes or reshapes a consumer or a
  > surface, propose the update to the user and edit the file once they agree. After editing it,
  > run `node ayme/product-surfaces/check.mjs`.

- **Type check.** The project's type check must cover the folder, or a surface can name a consumer
  that does not exist. When no `tsconfig.json` includes it, propose adding `"ayme/**/*.ts"` to the
  `include` of the one that fits. In a project without TypeScript, say so: the check script still
  verifies the consumer names and the sources.

The check loads `surfaces.ts` directly, which needs Node 22.18 or newer.
