# Releasing

Maintainer instructions for releasing the alpha package set: `@ayme-dev/ayme`, `@ayme-dev/vue`, `@ayme-dev/react`, `@ayme-dev/svelte`, `@ayme-dev/angular`, `@ayme-dev/unplugin-ayme` and `@ayme-dev/inspector`, the packages under `packages/` that are not private. They carry one shared version and are released together under the `alpha` dist-tag, so a consumer never combines versions that were not tested together.

## Release an alpha

1. Set the version of all packages in the set in one step and merge the change to `main`:

   ```sh
   pnpm release:version 0.1.0-alpha.1
   ```

   Without an argument, [`scripts/release-version.mjs`](../scripts/release-version.mjs) only checks the version and prints it. It refuses a version that is not an alpha version, such as `0.1.0`, and versions that differ between packages.

2. Run the `Release alpha` workflow ([`.github/workflows/release.yml`](../.github/workflows/release.yml)) from `main` with `publish` on:

   ```sh
   gh workflow run release.yml --ref main -f publish=true
   ```

The workflow checks the version, builds the packages and runs the packed-consumer check (`pnpm --filter @ayme-dev/ayme test:package`), which packs each package and keeps the tarballs. It uploads exactly those tarballs as the `packages` artifact, and only then does the publish job publish them with `npm publish --tag alpha` through npm trusted publishing. A failing check stops the run before anything is published. The workflow refuses to publish from any branch other than `main`.

## Dry run

With `publish` off, the default, the workflow stops after uploading the `packages` artifact, which holds the tarballs a release would publish. Like a release, it needs an alpha version on the branch it runs on, so run it on the branch that sets the next version before merging that branch. GitHub only dispatches a workflow that exists on the default branch, but such a run may target any branch.

To produce and check the same tarballs locally:

```sh
pnpm exec turbo run build --filter='./packages/*'
AYME_PACKED_DIR=/tmp/ayme-release pnpm --filter @ayme-dev/ayme test:package
```

The tarballs stay in `AYME_PACKED_DIR`, which must name an empty or absent directory.

## Trusted publishing

Each package trusts GitHub owner `ayme-labs`, repository `ayme` and workflow `release.yml`. npm configures a trusted publisher in the package's settings on npmjs.com, so a package name that is not on npm yet must be published once by hand first: produce the tarballs locally as in the dry run, from a clean `main` checkout, and run `npm publish <tarball> --tag alpha` for each. npm never accepts a version twice, so the workflow can only publish versions after the one published by hand.

Provenance requires each manifest's `repository` to name this repository; the packed-consumer check asserts it.

## A publish that fails partway

npm refuses to publish a version twice, so packages published before a failure stay published and rerunning the workflow fails. Fix the cause, set the next alpha version and release again, so the `alpha` dist-tag points at one consistent set.
