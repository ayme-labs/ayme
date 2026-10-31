# Agentic Playwright practices for Ayme's local test loop

Research only, 2026-10-28. Keep this draft PR unmerged under the [research-note convention][research-convention]. No lane, configuration or agent-policy change is proposed for adoption by this PR.

## Recommendation

Pilot a build-aware, focused Inspector fixture command with one worker and failure tracing. Use existing files and runner filters before inventing smoke tags. Keep broad affected CI coverage: an untouched downstream app can expose a core regression.

The useful lesson is making a small test command easy to choose. Migrating frameworks, copying its agent rule tree or weakening CI would not address the reported failures.

## Evidence and limits

- External source: [idavidov13/agentic-playwright at `f6cbf35b64f60d6f1337ab799118c2577e390260`][external-revision], the default-branch HEAD fetched on 2026-10-28, commit dated 2026-09-21. Inspected its scripts, config, fixtures, tests, workflows, rules and setup code. Did not install or execute its scaffold, dependencies, hooks, agents or tests. README claims and popularity are not effectiveness evidence.
- Ayme source: [`d75498f21726055407dfea69b26bfd8cf697bb94`][ayme-revision]. Read local configuration and checked installed CLI help, Playwright 1.64.0 and Vitest 4.1.11. Ran two Turbo dry graphs; no builds, browsers, application servers, test suites, root `pnpm check` or Stryker.
- The assigned baseline reports 10 executable e2e lanes for root selection or Ayme plus dependents, and 2 for explicit Ayme plus example-vue selection. These counts were supplied by the coordinator, not remeasured here. Source confirms [root check composition][root-package], [build dependencies][turbo] and [affected CI suites on separate runners][ayme-ci].
- [#1065 "Docs check crashes on generated screenshot directories ending in .ts"][screenshots], [#1066 "Angular SPA e2e server returns 404 from dot-directory worktrees"][angular-path] and [#1067 "Run change analysis on draft pull requests before review readiness"][draft-analysis] contain independently reproduced evidence or reported history. I read the tickets; I did not repeat those reproductions or inspect historical threads. Their fixes belong to the assigned workers.
- A help probe unexpectedly caused pnpm 11 to materialize this checkout's missing dependencies from its existing store and run Ayme's normal prepare hooks. No tracked file changed. This was not an external-scaffold install. Exclude that setup activity from any timing baseline.

## What the external implementation actually provides

| Area                       | Implementation and limitation                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selection                  | [Package scripts][external-package] wrap native `--project`, `--grep`, `--grep-invert`, `--workers=1`, `--ui`, `--debug` and headed mode. The login [functional example][external-login] has a real `@smoke` positive test and `@regression` negative cases. Regression is an exact tag slice, not an inclusive superset of smoke. The E2E [example][external-e2e] has placeholder action/assertion steps.             |
| Projects and setup         | [Config][external-config] enables `setup`, `api` and `chromium`. Chromium depends on setup and consumes saved auth state; API does not. Firefox/WebKit scripts exist but their projects are commented out. Setup is still prerequisite work when selecting a Chromium test.                                                                                                                                            |
| Resource use and lifecycle | Config sets `fullyParallel: true`, one worker on CI, default workers locally. There is no `webServer`; [application config][external-app-config] reads externally supplied URLs. It does not solve laptop contention or local readiness.                                                                                                                                                                               |
| Artifacts                  | Config uses local retries 0, CI retries 2, traces on first retry, failure screenshots, retained failure video, local HTML and CI blob/HTML reports. Consequently local failures have no default trace. Its [debugging guide][external-debug] explicitly advises `--trace on` or `retain-on-failure`, focused reruns and UI mode.                                                                                       |
| CI reality                 | [Playwright workflow][external-ci] runs the API project against a public demo and uploads HTML on failure. UI is excluded because of Cloudflare. [Template smoke][external-smoke-ci] validates the generated scaffold's types/lint/format/rules; its live API step is nonblocking. Neither proves the UI loop reliable or fast. Blob output is configured, but these workflows do not implement a blob merge pipeline. |
| Fixtures                   | [Merged fixtures][external-fixtures] inject page objects, API calls and helpers. [Helper example][external-helper] wraps setup/use/teardown; [auth setup][external-auth] creates reusable state. This is ordinary Playwright lifecycle reuse, not a changed-test selector or scheduler.                                                                                                                                |

[Playwright CLI][pw-cli] supports file, line, title, project and last-failure selection; [UI mode][pw-ui] supplies selective watch and replay. These are native features Ayme can use directly. `--last-failed` depends on the preceding run's result file and is a convenience, not a coverage decision.

## Agent automation versus written guidance

The [Claude hook registration][external-hook-settings] invokes a [Python checker][external-hook] only for `Write`, `Edit` and `MultiEdit`. Its seven text/path checks reject direct Playwright imports in spec/setup files, hard waits, loose schemas, selected XPath patterns, static JSON, `@functional` and tags in describe titles. It examines added text, permits malformed payloads, does not inspect shell writes and does not enforce exactly one valid tag, approved plans, cleanup or successful tests. Its import regex also matches a type-only Playwright import, which the functional example itself contains. These are static findings, not executed hook probes.

[ESLint][external-eslint] enforces awaits, no focused tests, no hard waits, typed code and assertion rules. Some locator/force/conditional rules are warnings; its plain lint script does not set `--max-warnings=0`, despite prose asking for no warnings. [Husky][external-precommit] runs staged lint/format plus conditional drift checks. [Skill CI][external-skill-ci] checks rule anchors, references, cross-links and versions; the [anchor script][external-drift] checks text presence, not behavioral compliance.

[AI-WORKFLOWS.md][external-workflows], [Claude rules][external-rules], [Cursor rules][external-cursor] and [Copilot instructions][external-copilot] prescribe exploration, affected-file verification, confidence scores and human approval gates. The gates remain agent instructions. Ayme already has [testing ownership][ayme-testing], [page-object fixtures][ayme-fixtures], lint/typecheck and [affected precommit checks][ayme-hooks]. Copying the three rule trees would add parallel sources to maintain and conflict with [Ayme's write-once rule][ayme-agents].

The [setup script][external-setup] can install Node/Python/browsers, create env files and [replace user-level CLI symlinks][external-links]. Its [CLI wrapper][external-cli-wrapper] separates browser caches for another Playwright version. Version isolation is sensible if needed; Ayme's Devbox and package-local executables already provide a project boundary. Do not adopt the global-link installer or the mandatory exploration-tool policy.

## Prioritized comparison

| Priority | Decision                              | Ayme candidate and tradeoff                                                                                                                                                                                                                                                                                                                                                 |
| -------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Adapt focused reruns                  | Prepare dependencies with Turbo, then select the owning file/project. Addresses repeated broad local runs and stale/missing `dist`. No new taxonomy; file choices require judgment and broader follow-up coverage.                                                                                                                                                          |
| 2        | Adapt explicit resource bounds        | Start with `--workers=1` for an Inspector fixture pilot. Its [config][ayme-inspector-config] currently leaves worker count at default. For broader local commands, `--concurrency=1` bounds Turbo tasks, not each runner's workers or other sessions. Less parallel work may take longer; contention improvement is a hypothesis.                                           |
| 3        | Adapt failure evidence                | Inspector fixture candidate: `--trace=retain-on-failure`, or later `use.trace` if justified. Shared [certification][ayme-cert-config] already retains failed traces and uses one worker; do not duplicate that configuration. Trace recording adds work even when successful traces are deleted. Avoid blanket video/HTML defaults and automatic report opening for agents. |
| 4        | Adopt native interaction, when useful | Use Playwright `--ui` for a human debugging a built fixture and Vitest `watch` for source/component tests. Rebuild workspace `dist` after dependency edits; test watch does not rebuild packages automatically. Persistent browsers/servers consume shared CPU. No new watch daemon.                                                                                        |
| 5        | Defer tags and new smoke projects     | Existing files and the Inspector's [unit/component projects][ayme-inspector-vitest] already narrow tests. A curated cross-file smoke set might later earn `@smoke` plus `--grep`; it would need a coverage promise and ownership. Reject the scaffold's six exclusive tags as a default, and do not call a tag-only slice full regression.                                  |
| 6        | Keep existing lifecycle and CI        | Ayme already has dynamic ports, strict Vite binds, disabled server reuse and [application warmup][ayme-warmup]. Retain them. Reject shared fixed ports, opportunistic reuse, longer timeouts, a scaffold migration, duplicated agent rules and reducing affected CI to the local smoke slice.                                                                               |

Artifact retention helps diagnose failures; it does not repair the scanner crash in #1065. Selection and worker limits do not fix the serving defect in #1066. Analysis scheduling is #1067's scope. No measured savings are claimed.

## Exact command candidates

All commands below are proposals to run inside the persistent Devbox shell from the repo root. They were not executed as test runs in this investigation. Keep build and runner arguments separate, especially for chained example scripts.

```sh
# Prepare only the Inspector fixture's build closure.
pnpm exec turbo run build --filter=@ayme-dev/inspector-fixture... --concurrency=1
# Confirm selection before spending browser time.
pnpm -C apps/inspector-fixture exec playwright test tests/mounting.spec.ts --list
# Focused run, no retry masking; preserves existing port/server lifecycle.
pnpm -C apps/inspector-fixture exec playwright test tests/mounting.spec.ts --workers=1 --retries=0 --trace=retain-on-failure
# Optional interactive rerun; stop it when the debugging session ends.
pnpm -C apps/inspector-fixture exec playwright test tests/mounting.spec.ts --workers=1 --ui

# Runtime browser file, through Vitest rather than Playwright Test.
pnpm exec turbo run build --filter=@ayme-dev/ayme... --concurrency=1
pnpm -C packages/ayme exec vitest run --config vitest.browser.config.ts src/runtime/toolFailures.browser.test.ts --maxWorkers=1 --no-file-parallelism
# Source/component watch, after preparing the Inspector's build closure.
pnpm exec turbo run build --filter=@ayme-dev/inspector... --concurrency=1
pnpm -C packages/inspector exec vitest watch --project=component src/panel/view/Header.browser.test.tsx --maxWorkers=1 --no-file-parallelism

# Broader local follow-up, explicitly two e2e lanes per supplied baseline.
# Includes example-vue's existing dev, benchmark and production subcommands.
pnpm exec turbo run test:e2e --filter=@ayme-dev/ayme --filter=@ayme-dev/example-vue --concurrency=1
```

Runner options were checked against installed help and [Vitest filtering docs][vitest-filter]. Neither Playwright's `--workers` nor its project names apply to Vitest. No runtime support or passing result is claimed from `--help` or dry graphs.

## One bounded next experiment and open decisions

After approval, use the same revision and two existing files, `tests/mounting.spec.ts` and `tests/stacking.spec.ts`. Mounting exercises tool runs and session restart; stacking covers panel/layer interactions. Prepare builds once and first use `--list` on both files. Compare default workers against `--workers=1`, both with retries 0 and retained failure traces. Alternate A/B order for three pairs, run sequentially, stop after ten minutes total or two failures with the same signature. Keep other sessions untouched and record their visible workload as a confounder.

On this macOS host, time each sample with these commands after the separate build step:

```sh
/usr/bin/time -l pnpm -C apps/inspector-fixture exec playwright test tests/mounting.spec.ts tests/stacking.spec.ts --retries=0 --trace=retain-on-failure
/usr/bin/time -l pnpm -C apps/inspector-fixture exec playwright test tests/mounting.spec.ts tests/stacking.spec.ts --workers=1 --retries=0 --trace=retain-on-failure
```

Record build preparation separately from each run's wall time, reported memory with its process/child-accounting limitation, actual worker/test counts, exit status and failure signature. Preserve failed traces before another run overwrites its results. Do not force a failure in production code; if none fails, trace usefulness remains unverified. Compare medians only as a small pilot, with all raw samples. One file normally runs sequentially already, so use both files to permit a meaningful worker comparison. Even these two may expose little contention; a null result does not justify a permanent cap. No all-app baseline is needed.

Choose afterward whether a documented command is sufficient, whether one fixture deserves a local worker default, and whether a stable cross-file smoke contract is worth maintaining. UI/watch benefit and trace overhead need separate evidence. Preserve affected CI integration coverage in every option. The coordinator should attach this draft research PR to the decision's originating issue; no such issue was supplied, and the three linked defect tickets have separate owners.

## Probe log

Read-only source inspection used `git clone --depth 1 https://github.com/idavidov13/agentic-playwright.git <temporary-dir>/upstream`, then `git rev-parse HEAD`, targeted `cat`/`sed`/`rg` and the three `gh issue view` calls. No env-file contents or secret values were read. Official upstream documentation was fetched on 2026-10-28.

Executed local probes, all inside the persistent `devbox shell`:

```sh
pnpm -C apps/inspector-fixture exec playwright test --help
pnpm -C packages/ayme exec vitest --help
pnpm exec turbo run test:e2e --filter=@ayme-dev/inspector-fixture --concurrency=1 --dry=json -- tests/mounting.spec.ts --workers=1 --trace=retain-on-failure
pnpm exec turbo run build --filter=@ayme-dev/inspector-fixture... --concurrency=1 --dry=json
```

The e2e graph contained one executable test task plus seven dependency builds. The separate build graph contained seven executable builds and no tests. Dry output attached CLI arguments to build records too; it was not treated as proof of runtime forwarding. The proposed two-step command avoids relying on that ambiguity. No workload timing was measured.

[research-convention]: https://github.com/ayme-labs/ayme/blob/d75498f21726055407dfea69b26bfd8cf697bb94/docs/agents/issue-tracker.md#research-notes
[ayme-revision]: https://github.com/ayme-labs/ayme/tree/d75498f21726055407dfea69b26bfd8cf697bb94/
[external-revision]: https://github.com/idavidov13/agentic-playwright/tree/f6cbf35b64f60d6f1337ab799118c2577e390260/
[root-package]: https://github.com/ayme-labs/ayme/blob/d75498f21726055407dfea69b26bfd8cf697bb94/package.json
[turbo]: https://github.com/ayme-labs/ayme/blob/d75498f21726055407dfea69b26bfd8cf697bb94/turbo.json
[ayme-ci]: https://github.com/ayme-labs/ayme/blob/d75498f21726055407dfea69b26bfd8cf697bb94/.github/workflows/ci.yml
[screenshots]: https://github.com/ayme-labs/ayme/issues/1065
[angular-path]: https://github.com/ayme-labs/ayme/issues/1066
[draft-analysis]: https://github.com/ayme-labs/ayme/issues/1067
[external-package]: https://github.com/idavidov13/agentic-playwright/blob/f6cbf35b64f60d6f1337ab799118c2577e390260/package.json
[external-config]: https://github.com/idavidov13/agentic-playwright/blob/f6cbf35b64f60d6f1337ab799118c2577e390260/playwright.config.ts
[external-app-config]: https://github.com/idavidov13/agentic-playwright/blob/f6cbf35b64f60d6f1337ab799118c2577e390260/config/app.ts
[external-login]: https://github.com/idavidov13/agentic-playwright/blob/f6cbf35b64f60d6f1337ab799118c2577e390260/tests/app/functional/login.spec.ts
[external-e2e]: https://github.com/idavidov13/agentic-playwright/blob/f6cbf35b64f60d6f1337ab799118c2577e390260/tests/app/e2e/e2e.spec.ts
[external-debug]: https://github.com/idavidov13/agentic-playwright/blob/f6cbf35b64f60d6f1337ab799118c2577e390260/.claude/skills/debugging/SKILL.md
[external-ci]: https://github.com/idavidov13/agentic-playwright/blob/f6cbf35b64f60d6f1337ab799118c2577e390260/.github/workflows/playwright.yml
[external-smoke-ci]: https://github.com/idavidov13/agentic-playwright/blob/f6cbf35b64f60d6f1337ab799118c2577e390260/.github/workflows/template-smoke.yml
[external-fixtures]: https://github.com/idavidov13/agentic-playwright/blob/f6cbf35b64f60d6f1337ab799118c2577e390260/fixtures/pom/test-options.ts
[external-helper]: https://github.com/idavidov13/agentic-playwright/blob/f6cbf35b64f60d6f1337ab799118c2577e390260/fixtures/helper/helper-fixture.ts
[external-auth]: https://github.com/idavidov13/agentic-playwright/blob/f6cbf35b64f60d6f1337ab799118c2577e390260/tests/app/auth.setup.ts
[external-hook-settings]: https://github.com/idavidov13/agentic-playwright/blob/f6cbf35b64f60d6f1337ab799118c2577e390260/.claude/settings.json
[external-hook]: https://github.com/idavidov13/agentic-playwright/blob/f6cbf35b64f60d6f1337ab799118c2577e390260/.claude/scripts/enforce_constitution.py
[external-eslint]: https://github.com/idavidov13/agentic-playwright/blob/f6cbf35b64f60d6f1337ab799118c2577e390260/eslint.config.mts
[external-precommit]: https://github.com/idavidov13/agentic-playwright/blob/f6cbf35b64f60d6f1337ab799118c2577e390260/.husky/pre-commit
[external-skill-ci]: https://github.com/idavidov13/agentic-playwright/blob/f6cbf35b64f60d6f1337ab799118c2577e390260/.github/workflows/skill-lint.yml
[external-drift]: https://github.com/idavidov13/agentic-playwright/blob/f6cbf35b64f60d6f1337ab799118c2577e390260/scripts/check-rules-drift.sh
[external-workflows]: https://github.com/idavidov13/agentic-playwright/blob/f6cbf35b64f60d6f1337ab799118c2577e390260/AI-WORKFLOWS.md
[external-rules]: https://github.com/idavidov13/agentic-playwright/blob/f6cbf35b64f60d6f1337ab799118c2577e390260/CLAUDE.md
[external-cursor]: https://github.com/idavidov13/agentic-playwright/blob/f6cbf35b64f60d6f1337ab799118c2577e390260/.cursor/rules/rules.mdc
[external-copilot]: https://github.com/idavidov13/agentic-playwright/blob/f6cbf35b64f60d6f1337ab799118c2577e390260/.github/copilot-instructions.md
[external-setup]: https://github.com/idavidov13/agentic-playwright/blob/f6cbf35b64f60d6f1337ab799118c2577e390260/scripts/setup.sh
[external-links]: https://github.com/idavidov13/agentic-playwright/blob/f6cbf35b64f60d6f1337ab799118c2577e390260/scripts/link-cli.sh
[external-cli-wrapper]: https://github.com/idavidov13/agentic-playwright/blob/f6cbf35b64f60d6f1337ab799118c2577e390260/scripts/playwright-cli.sh
[ayme-testing]: https://github.com/ayme-labs/ayme/blob/d75498f21726055407dfea69b26bfd8cf697bb94/docs/testing.md
[ayme-fixtures]: https://github.com/ayme-labs/ayme/blob/d75498f21726055407dfea69b26bfd8cf697bb94/apps/inspector-fixture/tests/fixtures.ts
[ayme-hooks]: https://github.com/ayme-labs/ayme/blob/d75498f21726055407dfea69b26bfd8cf697bb94/lefthook.yml
[ayme-agents]: https://github.com/ayme-labs/ayme/blob/d75498f21726055407dfea69b26bfd8cf697bb94/AGENTS.md
[ayme-inspector-config]: https://github.com/ayme-labs/ayme/blob/d75498f21726055407dfea69b26bfd8cf697bb94/apps/inspector-fixture/playwright.config.ts
[ayme-cert-config]: https://github.com/ayme-labs/ayme/blob/d75498f21726055407dfea69b26bfd8cf697bb94/apps/example-certification/src/config.ts
[ayme-inspector-vitest]: https://github.com/ayme-labs/ayme/blob/d75498f21726055407dfea69b26bfd8cf697bb94/packages/inspector/vitest.config.ts
[ayme-warmup]: https://github.com/ayme-labs/ayme/blob/d75498f21726055407dfea69b26bfd8cf697bb94/apps/example-certification/src/warmDevServer.ts
[pw-cli]: https://playwright.dev/docs/test-cli
[pw-ui]: https://playwright.dev/docs/test-ui-mode
[vitest-filter]: https://vitest.dev/guide/filtering.html
