# @ayme-dev/core

Framework-independent building blocks for observing how a web page's structure changes. Use it if you write browser tooling, test utilities or agent integrations that need to compare accessibility snapshots, track what changed after an action, and present the result compactly.

The package currently provides one module, **structural observation**, through the `@ayme-dev/core/structural-observation` subpath. It covers:

- structural trees parsed from ARIA snapshot YAML, and reconciliation of a before and an after capture into a change tree;
- optional typed enrichment of structural nodes;
- paired capture evidence, observation sessions and history;
- generic projection and compact text rendering.

It does not capture pages itself. Installing it gives you no browser automation: you supply the captures (see [Capture adapters](#capture-adapters)).

## Release status

`@ayme-dev/core` is in alpha. An alpha release is available on npm under the `alpha` dist-tag. Releases may contain breaking changes without notice, so pin an exact version:

```sh
npm install --save-exact @ayme-dev/core@alpha
```

The [npm version list](https://www.npmjs.com/package/@ayme-dev/core?activeTab=versions) shows the published alphas. The repository may contain changes that no published alpha includes yet.

## Usage

The package ships compiled ESM with TypeScript declarations. There is no root export; import from a subpath:

| Subpath                                         | Contents                                           |
| ----------------------------------------------- | -------------------------------------------------- |
| `@ayme-dev/core/structural-observation`         | Structural trees, capture, observation, projection |
| `@ayme-dev/core/structural-observation/testing` | Test doubles for consumers' own tests              |

## Example: what changed between two captures

Parse a before and an after capture, reconcile them, then project and render the change tree:

```ts
import {
  AriaRefSchema,
  StructuralTree,
  SyntheticAriaRefFactory,
  projectStructuralNodeForest,
  renderCompactStructuralNodeForest,
} from "@ayme-dev/core/structural-observation";

// Allocates `s_*` refs for nodes that have no capture ref.
const refs = new SyntheticAriaRefFactory();

const before = StructuralTree.fromAriaSnapshotYaml(
  `- main [ref=e1]:
  - heading "Cart" [level=1] [ref=e2]
  - list [ref=e3]:
    - listitem [ref=e4]: Tea
  - button "Checkout" [disabled] [ref=e5]`,
  refs
);
const after = StructuralTree.fromAriaSnapshotYaml(
  `- main [ref=e1]:
  - heading "Cart" [level=1] [ref=e2]
  - list [ref=e3]:
    - listitem [ref=e4]: Tea
    - listitem [ref=e6]: Coffee
  - button "Checkout" [ref=e5]`,
  refs
);

const change = StructuralTree.reconcile(before, after);
console.log(change.hasAnyChanges());
console.log(change.getNode(AriaRefSchema.parse("e6"))?.status?.kind);

const forest = projectStructuralNodeForest({
  roots: change.getRootNodes(),
  children: (node) => node.children,
  structuralNode: (node) => node,
});
console.log(renderCompactStructuralNodeForest(forest));
```

Output:

```text
true
added
- [ref=e1] main:
  - [ref=e2] heading "Cart" [level=1]
  - <changed> [ref=e3] list:
    - [ref=e4] listitem: Tea
    - <added> [ref=e6] listitem: Coffee
  - <changed> [ref=e5] button "Checkout"
```

Each node in the change tree has a status: `unchanged`, `added`, `removed` or `updated`. Removed nodes stay in the change tree, so a renderer can show what disappeared.

## Capture adapters

Core consumes captures; it does not take them. The input is ARIA snapshot YAML in the format produced by [Playwright's ARIA snapshots](https://playwright.dev/docs/aria-snapshots), optionally with `[ref=…]` attributes.

- For one-off comparisons, pass YAML strings to `StructuralTree.fromAriaSnapshotYaml`, as in the example.
- For repeated captures of a live page, implement the `LiveAriaSnapshotSource` interface over your own browser automation and pass it to `StructuralTreeCaptureService`. The service timestamps captures and returns capture evidence that resolves to structural trees on demand.

Playwright is not a dependency. Zod is the only runtime dependency.

## Reference scope

A structural ref, such as `e6` or `s_3`, addresses a node within one capture or change tree. It is not a browser locator, and it has no identity guarantee across captures.

- Refs come from the capture (`[ref=…]`). Nodes without one receive a synthetic `s_*` ref from `SyntheticAriaRefFactory`.
- `getBeforeNodeForAfterRef` reports which before node a raw after-capture ref was matched to, including unchanged matches and synthetic refs.
- `wasBeforeRefAmbiguous` distinguishes ambiguous removed refs from ordinary removals.

These are reconciliation facts. Turning a structural ref into an actionable browser target, and deciding how long an earlier ref stays usable, belong to your capture adapter and your application.

## Enrichment, presentation and testing

**Optional enrichment.** `defineStructuralEnrichment` declares a typed kind of extra per-node data, validated by a [Zod](https://zod.dev) schema, with its own change detection and named properties. `defineStructuralEnrichmentEvidence` attaches values for a capture. Projections choose which enrichment properties to include.

**Consumer-owned presentation.** `projectStructuralNodeForest` turns any tree of your own node type into a presentation-neutral forest. Its options decide which nodes, identities, statuses and properties appear, and which nodes are compacted. `renderCompactStructuralNodeForest` is one renderer for that forest; you can write your own. See the [example](#example-what-changed-between-two-captures).

**Testing subpath.** `@ayme-dev/core/structural-observation/testing` exports `StructuralTreeMockFactory` and `MockLiveAriaSnapshotSource` for your own tests. Neither depends on a testing framework. See [Capture adapters](#capture-adapters) for the interface `MockLiveAriaSnapshotSource` implements.

## Compatibility

**Runtime.** The same compiled ESM runs in Node.js and in browsers through a bundler. The package imports no Node.js built-ins and no browser automation.

**ARIA types.** The package defines its own structural `AriaNode` and `AriaRole` types, compatible with Playwright's ARIA snapshot definitions. Playwright's public package does not export its internal ARIA type entry, so `StructuralNode.fromAriaNode` accepts that compatible shape without importing Playwright.

## License

[FSL-1.1-ALv2](./LICENSE). The ARIA type definitions are derived from Playwright; their upstream notice is in [THIRD_PARTY_NOTICES.txt](./THIRD_PARTY_NOTICES.txt).
