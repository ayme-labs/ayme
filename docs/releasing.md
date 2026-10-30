# Releasing

Maintainer instructions for releasing the packages under `packages/` that are not private. [`release-please-config.json`](../release-please-config.json) sets how they are versioned; the [Release Please docs](https://github.com/googleapis/release-please#readme) explain its options.

## Release

Release Please keeps a release pull request open on `main`.

1. Review the version and the changelogs in the release pull request.
2. Approve the CI run GitHub holds on the release pull request, with **Approve and run** on its checks or on the run in the Actions tab. If no run appears, close the pull request and reopen it to create one.
3. Merge it.

Merging runs [`.github/workflows/release.yml`](../.github/workflows/release.yml) again. Release Please tags the release and creates a GitHub release per package. The workflow then builds that commit and runs the packed-consumer check (`pnpm --filter @ayme-dev/ayme test:package`), which packs each package and keeps the tarballs. It uploads exactly those tarballs as the `packages` artifact, and the publish job hands them to [`scripts/publish-packages.mjs`](../scripts/publish-packages.mjs), which publishes them through npm trusted publishing, with no npm token. A failing check stops the run before anything is published.

## Dry run

Run the workflow on any branch to get the `packages` artifact, which holds the tarballs a release would publish:

```sh
gh workflow run release.yml --ref <branch>
```

Such a run skips Release Please and publishes nothing. GitHub only dispatches a workflow that exists on the default branch, but the run may target any branch.

To produce and check the same tarballs locally:

```sh
pnpm exec turbo run build --filter='./packages/*'
AYME_PACKED_DIR=/tmp/ayme-release pnpm --filter @ayme-dev/ayme test:package
```

The tarballs stay in `AYME_PACKED_DIR`, which must name an empty or absent directory.

## First publish

This section is a one-time bootstrap. Trusted publishing cannot create a package, so the first version of each package goes to npm by hand. The same steps apply to a package added later.

Before the first release, turn on **Allow GitHub Actions to create and approve pull requests** in the repository's Actions settings; without it the workflow token cannot open the release pull request.

1. Merge the first release pull request. The publish job of the run that follows fails, because npm does not know the packages yet.
2. Download the tarballs that run verified, and publish each by hand in the order the publish job would use, `@ayme-dev/ayme` first and the rest by name:

   ```sh
   gh run download <run-id> --name packages --dir /tmp/ayme-first-release
   npm publish /tmp/ayme-first-release/<tarball> --access public
   ```

3. In each package's settings on npmjs.com, add a trusted publisher: GitHub owner `ayme-labs`, repository `ayme`, workflow `release.yml`, with **Allow npm publish** turned on under its allowed actions. npm's default allows only `npm stage publish`, and with that the next release's publish job fails.
4. Rerun the failed job, as below. It skips the published versions and passes. That proves the workflow but not the trusted publishers, since nothing was published through them.
5. Within two days of step 3, cut a real release through the workflow: the next version, from any `fix` or `feat` commit. npm [expires a new trusted publisher](https://docs.npmjs.com/trusted-publishers#trusted-publisher-configuration-expiry) that has no successful publish after two days; an expired one has to be deleted and created again.

Provenance requires each manifest's `repository` to name this repository; the packed-consumer check asserts it.

## Rerun after a failure

Fix the cause and use **Re-run failed jobs** on the same workflow run. Re-running all jobs does not work: Release Please then finds no new release, so the publish job is skipped. The publish script skips each version the registry already has and publishes the rest, so a publish that failed partway finishes from where it stopped.

If the fix changes repository code, merge it and release the next version instead; a rerun builds the tagged commit.

## Adding a package

A new package that is not private joins the release in [`release-please-config.json`](../release-please-config.json), under `packages` and in the linked group's `components`, and in [`.release-please-manifest.json`](../.release-please-manifest.json) at the current version. [`scripts/release-config.test.mjs`](../scripts/release-config.test.mjs) fails until it does. Its first version needs the [first publish](#first-publish) steps.
