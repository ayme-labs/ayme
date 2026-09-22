# Releasing `@ayme-dev/core`

Maintainer instructions for publishing and verifying `@ayme-dev/core`. The package's consumer documentation is its [README](../packages/core/README.md).

## Publishing

npm requires a package to exist before it can trust a GitHub Actions publisher. An npm maintainer for the `@ayme-dev` scope must publish the first alpha from a clean `main` checkout:

```sh
pnpm --filter @ayme-dev/core test:package
cd packages/core
npm publish --tag alpha
```

Then configure the package's [trusted publisher](https://docs.npmjs.com/trusted-publishers/) for GitHub owner `ayme-labs`, repository `ayme`, and workflow `publish-core.yml`, with direct publishing allowed. For later alphas, bump the prerelease version on `main` and manually run the `Publish core alpha` workflow ([`.github/workflows/publish-core.yml`](../.github/workflows/publish-core.yml)).

## Package verification

`pnpm --filter @ayme-dev/core test:package` builds and packs a candidate, installs it outside the workspace, exercises both runtime exports, checks declarations with NodeNext and Bundler resolution, checks assignability from the pinned public Playwright ARIA definition, and bundles both exports for the browser. It also type-checks and runs the README example from the installed package and compares its output with the README. It checks the bundle input graph and writes the tarball manifest and SHA-256 to `verification.json`. An optional directory argument retains the artifact at a chosen location.

## ARIA type ownership

The package owns the structural `AriaNode` and `AriaRole` definitions in `packages/core/src/tree/StructuralTypes.ts`, because Playwright's public package does not export its internal ARIA type entry. The definitions' upstream notice is retained in `packages/core/THIRD_PARTY_NOTICES.txt`. `test:package` checks that the pinned public Playwright definition stays assignable to them.
