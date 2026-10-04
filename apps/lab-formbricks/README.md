# Formbricks lab app

[Formbricks](https://github.com/formbricks/formbricks) as a lab app: a real product with hard UI to measure agents on. The `ayme-labs/formbricks` fork is a git submodule at [`formbricks/`](./formbricks), pinned to an exact commit. It stays outside the pnpm workspace, and neither `git clone` (even with `--recurse-submodules`) nor `pnpm install` fetches it. Only `pnpm lab:prepare` does.

This lab app runs on a Mac only, by hand. It is never part of CI or `pnpm check`.

## Prerequisites

- Docker Desktop, running
- the Ayme Devbox shell
- free ports `3000` (Formbricks), `4000-4001`, `5432`, `6379`, `8025`, `1025`, `8080` and `9000-9001` (Formbricks's dev services)

## Commands

From this directory inside `devbox shell`:

```sh
pnpm lab:prepare
pnpm lab:dev
```

`lab:prepare` checks out the pinned submodule commit, installs Formbricks's dependencies with the pnpm version Formbricks declares, and creates its ignored `.env` the first time. It refuses to touch a dirty submodule checkout.

`lab:dev` starts Formbricks's own dev stack: its services in Docker and the app at http://localhost:3000. It runs until you stop it with `Ctrl+C`.

With `lab:dev` running, in a second Devbox shell:

```sh
pnpm lab:smoke
```

`lab:smoke` runs Formbricks's own start-from-scratch Playwright scenario against the running app.

After `Ctrl+C`, stop the Docker services:

```sh
pnpm lab:stop
```

`lab:stop` keeps the Docker volumes, so the data survives. There is no reset command, because deleting the volumes is destructive.
