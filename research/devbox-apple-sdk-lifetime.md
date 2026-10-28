# Devbox's Apple SDK lifetime

Research only, 2026-10-28. Close this PR unmerged after recording the decision. No repair or policy adoption is proposed by the act of publishing it.

## Finding

The strongest explanation is an unrooted development environment, followed by reuse of its cached paths. A fresh Ayme Devbox shell works today, but its declared-package profile does not retain the Apple SDK that the shell exports. Missing SDK directories and Turbo dropping an environment variable are different failures. Adding environment pass-through cannot retain a store path.

The smallest project repair to test is declaring the existing default `apple-sdk` as a Darwin-only Devbox package from the same locked nixpkgs input. This should place the SDK in Devbox's existing profile, while preserving `DEVELOPER_DIR` and `SDKROOT`. It is a source-backed candidate, not a verified repair. The better upstream fix would retain the whole computed development environment through Nix's native profile mechanism.

## What was observed here

Checkout baseline [d75498f21726055407dfea69b26bfd8cf697bb94](https://github.com/ayme-labs/ayme/tree/d75498f21726055407dfea69b26bfd8cf697bb94), branch `t3/investigate-devbox-sdk-lifetime`, worktree `/Users/abelenekes/.t3/worktrees/ayme/t3-de4e9d15`. Probes ran around 09:22–09:27 UTC in one persistent `devbox shell`. Devbox reported `0.18.3`; Nix reported `Determinate Nix 3.15.2`, based on Nix `2.33.1`.

- Outside Devbox, both SDK variables were absent. `git` resolved to `/usr/bin/git`, `xcrun` to `/usr/bin/xcrun`.
- Inside, `git` still resolved to `/usr/bin/git`. `xcrun` resolved to `/nix/store/cyfhvbjl8axx1zns5n49zyhfmz2bji5c-xcbuild-0.1.1-unstable-2019-11-20-xcrun/bin/xcrun`.
- `DEVELOPER_DIR` was `/nix/store/ji7chjspdr4nxh0wys6n9klf13l9cxjb-apple-sdk-14.4`. `SDKROOT` was its `Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk` subdirectory. Both existed. `git --version`, `git rev-parse HEAD`, `xcrun --find git`, and `xcrun --show-sdk-path` succeeded. Both Nix and Apple `xcrun --find git` selected `/Library/Developer/CommandLineTools/usr/bin/git`.
- The generated cache recorded Node in `buildInputs`, the SDK in `defaultBuildInputs`, and the same SDK variables as the shell. Offline evaluation of the generated flake's locked `apple-sdk.outPath` returned exactly that SDK path.
- The project profile was `/nix/store/vkylgkpxzjcav6132c1gpga7bfqbhpc7-profile`. Its recursive runtime closure contained Node, npm, and Corepack, but no `apple-sdk`, stdenv, or xcrun. An automatic GC-root symlink retained this project's `default-1-link` profile generation.
- `nix-store --query --roots "$DEVELOPER_DIR"` returned no roots. It also emitted a housekeeping message removing an already-stale automatic link to `/tmp/ayme-4f1b91ec-apple-sdk-root`. I did not request root deletion, but this query had that side effect. Subsequent root inspection used filesystem reads only.
- Filtered client settings reported `keep-derivations = true`, `keep-outputs = false`, and `min-free = 0`. These are client observations, not proof of the running daemon's effective configuration. Nix documents that system configuration read by a client is not forwarded to the daemon. [Nix configuration](https://nix.dev/manual/nix/2.33/command-ref/conf-file.html)
- `determinate-nixd` and `nix-daemon` were running. The launch daemon's program was `/usr/local/bin/determinate-nixd daemon`. `/etc/determinate/config.json` was absent. `df -h /nix` showed about 14 GiB available and 98% capacity. Current upstream documentation says Nixd enables managed GC by default and tries to retain at least 30 GB free. That provides a plausible background trigger even with the client's `min-free = 0`; it does not identify the historical deletion event or establish the installed version's exact thresholds. [Determinate Nixd](https://docs.determinate.systems/determinate-nix/determinate-nixd/)

The missing-path failure was not reproduced. No reboot or deliberate collection was performed.

## Who sets the environment and invokes xcrun

Ayme declares Node from nixpkgs and enables the Node plugin. Its lock pins nixpkgs to `c9fe7d12cd78d1adcd12dd15e24432dde5b155a0`. There is no project SDK override or startup validation. [devbox.json](https://github.com/ayme-labs/ayme/blob/d75498f21726055407dfea69b26bfd8cf697bb94/devbox.json), [devbox.lock](https://github.com/ayme-labs/ayme/blob/d75498f21726055407dfea69b26bfd8cf697bb94/devbox.lock)

The nixpkgs SDK setup hook exports the SDK directory and sysroot. Devbox obtains the Nix environment with `nix print-dev-env --json`, then layers those exported variables over the parent environment. The Node plugin configures Corepack and `PATH`; it does not set either SDK variable. Thus the first setter is the Nix SDK hook, and Devbox transports its result into the shell. [SDK hook at the locked revision](https://github.com/NixOS/nixpkgs/blob/c9fe7d12cd78d1adcd12dd15e24432dde5b155a0/pkgs/by-name/ap/apple-sdk/setup-hooks/sdk-hook.sh), [Devbox environment construction](https://github.com/jetify-com/devbox/blob/6bf4b571c5ecd64d00212ab92fd62f5b7080d3b9/internal/devbox/devbox.go#L632), [Node plugin](https://github.com/jetify-com/devbox/blob/6bf4b571c5ecd64d00212ab92fd62f5b7080d3b9/plugins/nodejs.json)

Apple's `/usr/bin/git` is a tool-selection stub that invokes `xcrun git`, rather than the final Git executable. A nixpkgs maintainer describes that chain and the system-toolchain fallback. Locally, `/usr/bin/git` links `libxcselect`, and both xcrun implementations find the Command Line Tools executable. I did not trace a failing invocation. This explains why a metadata-only operation can fail before Git handles `rev-parse`. [Nixpkgs #355486 "apple_sdk's setup hook breaks /usr/bin/git in devshells", maintainer explanation](https://github.com/NixOS/nixpkgs/issues/355486#issuecomment-2471630549)

## Why the lifetime explanation fits

Devbox 0.18.3 synchronizes its package profile from `buildInputs` only. Its Nix invocation does not pass `--profile`; the resulting JSON cache lives outside the store. On a cache hit, the inspected cache reader does not validate SDK directory existence. Nix roots retain their runtime references; an environment variable or ordinary cached JSON file is not such a root. [Profile synchronization](https://github.com/jetify-com/devbox/blob/6bf4b571c5ecd64d00212ab92fd62f5b7080d3b9/internal/devbox/nixprofile.go#L17), [environment cache](https://github.com/jetify-com/devbox/blob/6bf4b571c5ecd64d00212ab92fd62f5b7080d3b9/internal/nix/nix.go#L48), [GC roots](https://nix.dev/manual/nix/2.33/package-management/garbage-collector-roots)

Consequently, the current Node profile can remain healthy while the SDK used to construct its shell becomes collectible. The SDK's referrers here included compiler wrappers, stdenv, and a shell-environment output, but the roots query found no retaining root. Merely finding a referrer is insufficient. `keep-derivations` preserves recipes, while `keep-outputs` controls retention of their outputs. [Nix GC settings](https://nix.dev/manual/nix/2.33/command-ref/conf-file.html#conf-keep-outputs)

Stale parent state remains possible for individual incidents, especially existing shells and nested runs. Devbox reuses the current environment when `devbox run` is invoked inside the same project's enabled shell. The fresh outside process here had neither variable, which rules out parent inheritance as their origin for this observation. The current cache and shell agree, so there is no present mismatch to diagnose. [Nested-run handling](https://github.com/jetify-com/devbox/blob/6bf4b571c5ecd64d00212ab92fd62f5b7080d3b9/internal/devbox/devbox.go#L253)

Turbo's strict mode filters unlisted variables and retains `PATH`. Ayme does not pass the SDK variables through its root task config. This may matter separately for native compilation inside Turbo tasks, but cannot delete an SDK directory. The goal script itself runs directly through Node, invokes Turbo only as a child for builds, and later invokes Git in its original process environment. A child cannot remove those variables from its parent. Broad pass-through would therefore not repair the reported end-of-run failure. [Turbo env mode](https://turborepo.dev/docs/reference/run#--env-mode-option), [Ayme Turbo config](https://github.com/ayme-labs/ayme/blob/d75498f21726055407dfea69b26bfd8cf697bb94/turbo.json), [goal script](https://github.com/ayme-labs/ayme/blob/d75498f21726055407dfea69b26bfd8cf697bb94/apps/example-vue/scripts/goal-runs.ts#L113)

## Historical evidence, not reproductions

- [#1059: done accepted on a coin flip](t3-thread://v1/mcp:1a3d9175-2bdd-4dac-9639-9876e020e09e), position 208, reports a reboot, two SDK removals, a temporary root, and reconstruction of a completed 20-run result after record writing failed. Position 292 repeats the GC explanation. Positions 254 and 298 add test/cleanup context, not a deletion trace. Related PR #1064 "fix(ayme): hand back done only when the model is confident the goal holds" is [here](https://github.com/ayme-labs/ayme/pull/1064).
- [Run Page State Session Design](t3-thread://v1/ff69202f-b619-4a79-9cb2-efdcca43f674), positions 325 and 328, reports a nonexistent SDK path and successful retry with `DEVELOPER_DIR` unset.
- [Inspector Panel Geometry Design](t3-thread://v1/413cbff1-02de-4991-9b28-ad79fd01f6e7), positions 131 and 177, reports the same failure during change analysis and unsetting both SDK variables.
- The brief's six-of-sixteen count was supplied by the prior investigation; this worker did not repeat that survey. Upstream Devbox #2566 "git broken inside all devbox projects with a 'xcrun: error: missing DEVELOPER_DIR path'" reports the same missing-path symptom. Its unsetting and explicit-Git workarounds are reports, not proof of this machine's cause. [Upstream report](https://github.com/jetify-com/devbox/issues/2566)

## Repair candidates and the separate recording fix

Prefer a Darwin-only declaration of `github:NixOS/nixpkgs/nixpkgs-unstable#apple-sdk`, sharing the existing locked input. Offline evaluation confirmed that attribute equals today's selected SDK. Verify profile membership and unchanged compiler selection before adopting it. Devbox supports platform-scoped packages; the installed CLI accepts `--platform`. This retains one dependency without hardcoding a store hash. It does not guarantee retention of every other stdenv tool. [Devbox package configuration](https://www.jetify.com/docs/devbox/configuration#adding-platform-specific-packages)

For the upstream boundary, Nix already supports `print-dev-env --profile`; its implementation profiles the recorded environment output. Devbox could retain that environment alongside its package profile and validate cache references before reuse. That is a recommendation for upstream investigation, not a local wrapper. The relevant profile-sync code is unchanged in Devbox 0.18.5; its cache reader adds corrupt-JSON recovery, not SDK existence validation or an environment profile. An upgrade alone is not an evidenced fix. [Nix option](https://nix.dev/manual/nix/2.33/command-ref/new-cli/nix3-print-dev-env), [Nix implementation](https://github.com/NixOS/nix/blob/2.33.1/src/nix/develop.cc#L500), [Devbox 0.18.5 cache](https://github.com/jetify-com/devbox/blob/67a893a6d8b41c6a8d9466d8c01e7a6172e4cecd/internal/nix/nix.go#L48), [0.18.5 profile synchronization](https://github.com/jetify-com/devbox/blob/67a893a6d8b41c6a8d9466d8c01e7a6172e4cecd/internal/devbox/nixprofile.go#L17)

A small startup check can reject absent SDK directories and failing Git before costly work, using Devbox's native `init_hook`. It detects an already-broken environment, but cannot retain a dependency or prevent mid-run collection. Keep compiler variables intact. Adding Nix Git alone bypasses Apple's selector but leaves compiler lifetime unresolved. Global `keep-outputs` changes have a wider storage effect and are a poor first experiment on this nearly full disk. No option was applied.

The goal recorder has a separate, justified defect. It launches all model calls, parses Playwright's temporary JSON report, then calls synchronous Git twice before creating the final output directory/file. Neither Git call is caught. There is no demonstrated reason to defer mandatory metadata until then; it also labels the ending checkout rather than the starting checkout. [Recorder ordering](https://github.com/ayme-labs/ayme/blob/d75498f21726055407dfea69b26bfd8cf697bb94/apps/example-vue/scripts/goal-runs.ts#L122)

Capture mandatory SHA/dirty metadata before builds and model calls, and persist that starting metadata with the report location. Keep the raw report in the invocation's durable output directory and print its path before execution. Finalization should use the captured metadata and require no Git call. A fixture-only test can make Git fail after a stubbed run and verify that results survive, without a model request or SDK override. Whether startup metadata failure should abort or allow an explicitly unknown revision remains a product decision. A general recovery CLI is unnecessary for the first fix.

## Next experiment, not run

First capture passive snapshots during the next normal session, at startup and immediately on failure, before restarting Devbox. Record only SDK variables and their presence/existence, resolved Git/xcrun paths, cache mtime and the same allowlisted cached fields, profile target/closure, and filesystem GC-root links. Use a cheap `git rev-parse HEAD` as the health check; do not run paid goals just to wait for the failure.

- Shell path differs from a valid cache and newly opened shell: stale inheritance or shell state.
- Shell and cache name the same vanished SDK while the Node profile survives: lifetime/cache invalidation, independent of Turbo.
- SDK survives and only a Turbo child omits the variable: environment filtering, requiring a separate compilation-specific investigation.
- To attribute deletion to Nixd, obtain a bounded daemon event naming that exact store hash/time. Current free space and an active daemon are insufficient proof.

After that evidence, a separately approved disposable Devbox project can compare today's declaration with the Darwin SDK declaration. The initial acceptance check is that the selected SDK is in the project profile's runtime closure, while both variables and compiler selection retain their intended values. Full lifecycle proof would require an isolated store or VM with controlled GC. No reboot, GC, root manipulation, SDK override, or installation should be attempted on the shared host for that proof.

Open decisions are whether to test the project SDK declaration, pursue upstream environment rooting, add fail-fast startup validation, and how strict the recorder's startup metadata contract should be. No policy decision is implied by this research.

## Commands and limits

The principal inspection commands were:

```sh
devbox shell
command -v devbox nix git xcrun
devbox version
nix --version
printf 'DEVELOPER_DIR=%s\nSDKROOT=%s\n' "$DEVELOPER_DIR" "$SDKROOT"
printf 'present=%s,%s\n' "${DEVELOPER_DIR+x}" "${SDKROOT+x}"
ls -ld "$DEVELOPER_DIR" "$SDKROOT"
git --version
git rev-parse HEAD
xcrun --find git
/usr/bin/xcrun --find git
xcrun --show-sdk-path
nix-store --query --requisites .devbox/nix/profile/default
nix-store --query --referrers "$DEVELOPER_DIR"
# This query unexpectedly pruned an already-stale auto-root link. Do not use it
# as a strictly side-effect-free sampler; read symlink references instead.
nix-store --query --roots "$DEVELOPER_DIR"
nix config show 2>/dev/null |
  rg '^(keep-outputs|keep-derivations|auto-optimise-store|min-free|max-free) ='
nix eval --offline --no-write-lock-file --impure --raw --expr \
  'let f = builtins.getFlake "path:/Users/abelenekes/.t3/worktrees/ayme/t3-de4e9d15/.devbox/gen/flake"; in f.inputs.nixpkgs.legacyPackages.aarch64-darwin.apple-sdk.outPath'
otool -L /usr/bin/git
ps -axo comm | rg 'determinate|nix-daemon'
/usr/bin/plutil -extract ProgramArguments json -o - \
  /Library/LaunchDaemons/systems.determinate.nix-daemon.plist
df -h /nix
devbox add --help
```

Source reads used `rg`, `cat`, `sed`, `gh api`, and raw upstream files downloaded under `/tmp/ayme-sdk-research-hyrWLd`. Node filesystem reads inspected symlinks and only the cached `DEVELOPER_DIR`, `SDKROOT`, `buildInputs`, `defaultBuildInputs`, and `stdenv` fields. The Determinate JSON check tested existence and would have selected only `garbageCollector.strategy`; the file was absent. No env files or secret values were read. Thread reads used `t3_thread_read` around the positions cited above. One offline evaluation without `--impure` failed because the local flake reference was unlocked; the successful retry above did not install packages. `man xcrun` was unavailable. `xcrun_log=1 /usr/bin/git --version` succeeded without extra trace output. `determinate-nixd --version` was unsupported.

Deviation: `pnpm exec turbo --version` unexpectedly auto-installed this initially empty worktree's workspace dependencies from the existing pnpm store and ran package lifecycle/prepare scripts, including Lefthook setup. It returned Turbo `2.11.3`; tracked files remained unchanged. This exceeded the no-installation probe limit. No further pnpm probes were used. No deliberate Nix package installation, global repair, shell-profile edit, root replacement, or SDK override was performed. The stale-root housekeeping above was the other unintended side effect. No `pnpm check`, browser suite, Stryker run, paid goal, reboot, or collection was requested.
