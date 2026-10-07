# Framework integrations

What a framework integration ships and the behaviour it must have. Read it before adding a framework or changing one of the existing integrations: Vue (with Nuxt), React (with Next.js), Svelte (with SvelteKit) and Angular.

This page holds only the behaviour contract and the list of files a new framework touches. Everything else is linked to where it is decided.

## What an integration is

An integration is a thin adapter over the public runtime session from `@ayme-dev/ayme`. It maps the session's lifetime onto the framework's: an owner creates and starts the session at the application root, and consumers read its status and register Page Objects for as long as they live. Framework-independent behaviour belongs in core, not in the adapter.

API names follow [ADR-0017](adr/0017-keep-framework-integration-apis-closely-aligned.md): the same names in every framework (`AymeProvider`, `useAyme`, `usePageObject`, and the `{ ayme, webMCP }` value), with framework-native names where the framework requires them, as Angular's `provideAyme`, `injectAyme` and `injectPageObject`. One runtime owner per document and its lifetime come from [ADR-0030](adr/0030-application-setup-owns-the-runtime-and-decides-publication.md); application code driving Ayme through the runtime object from [ADR-0031](adr/0031-application-code-drives-ayme-through-the-runtime-object-setup-returns.md); the package split from [ADR-0029](adr/0029-use-a-shared-ayme-package-with-separate-framework-and-build-integrations.md).

## Package checklist

- `packages/<framework>`, published as `@ayme-dev/<framework>`, with the Turbo boundaries tag `adapter`. Copy the manifest fields, `LICENSE`, tsdown, ESLint and TypeScript setup of an existing integration.
- `@ayme-dev/ayme` is a dependency; the framework is a peer dependency whose range runs from the tested floor to the current major.
- Only `@ayme-dev/ayme` declares the optional `@playwright/test` peer. An integration does not.
- The owner takes the runtime options type as is, instead of re-declaring each option.
- The integration uses the public runtime session. It imports `@ayme-dev/ayme/internal` only for what the public API does not export yet, such as the Page Object constructor type.
- Every row of the behaviour contract holds, or is n/a where the row allows it.

## Behaviour contract

Row ids are stable: a row that goes away leaves its id unused, and a new row takes the next number. Each framework package's tests cite the ids they cover. An error text in backticks is required verbatim, with `<owner>` standing for the integration's owner API.

| Id  | Required behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Error text                                                                                                                                                                                                                                                                                                                                          | n/a allowed                                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | **Options reach the runtime session unchanged.** The owner passes every runtime option to the session as given.                                                                                                                                                                                                                                                                                                                                                         | None.                                                                                                                                                                                                                                                                                                                                               | Never.                                                                                                                                     |
| C2  | **The owner starts the session in the browser and stops it on dispose.** The session is started before a descendant's Page Object needs it, and stopped when the owner is unmounted, destroyed or its injector is destroyed.                                                                                                                                                                                                                                            | None.                                                                                                                                                                                                                                                                                                                                               | Never.                                                                                                                                     |
| C3  | **A nested or second owner is rejected.** An owner beneath another owner throws. A second owner in the same document, while the first is active, fails with the session's owner conflict; a new owner after the first is disposed works. Where one call is both owner and consumer (Vue's and Svelte's `useAyme`), the call beneath an owner without options returns the owner's value, and with options it throws an error that names the ancestor owner to configure. | Nested owner: `<owner> cannot be nested beneath another Ayme runtime owner.` Second owner: the session's `The Ayme runtime already has an active owner.`, a `RuntimeStateError` with `code: "active-owner"` that an integration recognises by its code, or an integration's error that says where to call the owner, with the session's as `cause`. | The nested-owner text, where one call is both owner and consumer; that call's options error replaces it.                                   |
| C4  | **Options stay fixed while an owner is mounted.** Changing an option of a mounted owner throws; remounting the owner changes it.                                                                                                                                                                                                                                                                                                                                        | `The provider options must stay fixed while mounted. Remount the provider to change them.`                                                                                                                                                                                                                                                          | Where the framework gives the owner its options once and cannot change them afterwards, as Svelte's `useAyme` and Angular's `provideAyme`. |
| C5  | **Status follows the session and retry belongs to the session.** The consumer exposes `webMCP.publicationStatus` as the framework's reactive value, updated on every change of the session's status, and `webMCP.retryPublication` is the session's own retry.                                                                                                                                                                                                          | None.                                                                                                                                                                                                                                                                                                                                               | Never.                                                                                                                                     |
| C6  | **A Page Object is registered while its consumer lives.** The consumer registers the model with the session and returns the session's instance of it; its tools stay registered while any consumer of that model lives and are removed when the last one is disposed.                                                                                                                                                                                                   | None.                                                                                                                                                                                                                                                                                                                                               | Never.                                                                                                                                     |
| C7  | **A consumer without an owner fails with a clear error.**                                                                                                                                                                                                                                                                                                                                                                                                               | Names the owner to add and where it goes.                                                                                                                                                                                                                                                                                                           | Never.                                                                                                                                     |
| C8  | **An uncompiled model fails.** A Page Object Model the compiler did not reach throws instead of registering.                                                                                                                                                                                                                                                                                                                                                            | The session's `The imported page object has no compiler-derived Ayme metadata.`                                                                                                                                                                                                                                                                     | Never.                                                                                                                                     |
| C9  | **On the server, concurrent requests share nothing and register nothing.** Each request gets its own session; nothing starts, the page factory is not called, Page Objects are inert and nothing is registered.                                                                                                                                                                                                                                                         | None.                                                                                                                                                                                                                                                                                                                                               | When the integration does not support server rendering and its README says so.                                                             |
| C10 | **On the server, the initial status is what hydration expects.** The server renders `waiting` when publication is enabled and `disabled` otherwise, the same status the browser starts with.                                                                                                                                                                                                                                                                            | None.                                                                                                                                                                                                                                                                                                                                               | As C9.                                                                                                                                     |
| C11 | **The Goal Loop is reachable.** The owner and consumer return the session as `ayme`, so `ayme.tools.run("goal", …)` runs a goal with the owner's `goalLoop`.                                                                                                                                                                                                                                                                                                            | None.                                                                                                                                                                                                                                                                                                                                               | Never.                                                                                                                                     |

## Server rendering

Core makes the runtime session inert on the server: starting it starts nothing and returns a stop function that does nothing, and a Page Object is an object with the model's prototype that never calls the page factory and registers nothing. The integration starts the session and registers Page Objects the same way on the server as in the browser, with no guard of its own. The initial status (C10) comes from the session; the integration renders it unchanged.

## Tests

The lanes, their commands and where test-only code lives are in the [testing guide](testing.md). An integration has:

- **Client tests** of the owner and consumer API in a real browser, Vitest browser mode on Chromium as the Inspector's component tests use. They cite the contract rows they cover. A row an integration skips is marked n/a in its tests with the reason the row allows.
- **Server tests** in Node that render concurrent requests, for C9 and C10.
- **Example certification**: the example apps' end-to-end tests, below.
- **Packed-consumer checks**: the package in the tarball lists and a type-check consumer at its framework floor.
- **Minimum-version lanes** in the CI compatibility matrix: the package's own tests at the framework floor, and the example's end-to-end tests at the meta-framework floor. The tested floors are in the root README's [supported versions](../README.md#supported-versions) table.

## Example app

Each framework is certified in a server-rendered app and in an SPA: through a config switch where the meta-framework supports both, otherwise with a separate SPA example. Each runs against its dev server and a production build. An example is a private app under `apps/` with the Turbo tag `app`; its README says what it certifies and links the package README for setup.

Its Page Object Models live in the app's own source, because the build plugin compiles them only from there. Its end-to-end tests run the shared [example certification](../apps/example-certification/README.md), which drives the counter contract written down there, calls tools through the recording WebMCP driver from `@ayme-dev/ayme/testing`, and checks:

- the server-rendered HTML and the initial publication status, across repeated requests;
- the exact published tool schemas;
- that an undecorated subclass of a Page Object Model is published;
- Ayme's own tool list;
- that hydration warnings and console errors fail the test;
- that a `click` that starts a full page load answers with the loading URL before the new page loads;
- that `navigate` to another page answers with the loading URL before that page loads, and that page publishes Ayme's own tools;
- that `navigate_back` to the previous document and `reload` answer with the loading URL before the page loads;
- that client navigation removes and restores a page's tools, where the app navigates;
- that editing an imported type rebuilds the published tools on the dev server.

## Docs

The package README owns installation, setup, the API, and the supported versions and limits. The root README lists the integration and its floor; the shipped skill's onboarding step names its root setup. The example README covers running the example.

## Release

A package under `packages/` that is not private joins the alpha release set and its shared version; see [releasing](releasing.md).

## Touch list

A new framework edits these files outside its own package and example:

- the root [README](../README.md): the framework list and the supported-versions row;
- the [testing guide](testing.md)'s E2E lane, for the example's render modes and servers;
- the skill's [onboarding step](../skills/ayme/references/onboarding.md);
- the [packed-consumer test](../packages/ayme/src/packedConsumer.test.ts): the tarball lists and the framework floors;
- the CI compatibility matrix in [`ci.yml`](../.github/workflows/ci.yml): the package's floor lane and the example's end-to-end lane;
- the [Prettier ignore list](../.prettierignore), for the example's build output;
- `pnpm-lock.yaml`;
- [releasing](releasing.md)'s list of the release set;
- [ADR-0029](adr/0029-use-a-shared-ayme-package-with-separate-framework-and-build-integrations.md)'s package list;
- the [core README](../packages/ayme/README.md)'s list of `/internal` consumers, if the package imports it.

Only when the framework needs them:

- a bundler entry in `packages/unplugin-ayme`, when the framework's build has none yet, as Angular's esbuild entry;
- `pnpm-workspace.yaml`, for overrides or package extensions the framework's dependencies need.

## Known gaps

- The Angular example is tested end to end from Angular 21.0, not from the package's 19.0 floor: it uses APIs and an `angular.json` setting that Angular 19 and 20 do not have, and running it there would take a second set of source files. The package's own tests cover 19.0.

## Deferred decisions

Revisit these when a fifth framework is scheduled:

- **No shared unit suite with a driver per framework.** The four owner and consumer APIs differ in how they mount, inject and dispose, so each driver would be about as large as the tests it replaces. The contract rows keep the tests aligned instead.
- **No scaffold script or skill.** This page's checklist and touch list are the scaffold; a generator built from four integrations would also copy what they do differently.
- **No generated CI matrix entries, and no test that checks floors against peer ranges.** The matrix entries carry framework-specific pins and workarounds that a generator would have to special-case.
