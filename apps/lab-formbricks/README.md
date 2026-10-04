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

`lab:dev` starts Formbricks's own dev stack: its services in Docker and the app at http://localhost:3000. It runs until you stop it with `Ctrl+C`. On the first start it also projects Formbricks's data into its authorization store and marks the survey scope ready, the state Formbricks's own CI calls production: a new survey starts restricted, and activating it asks who can view it. The marker lives in the Docker volume, so later starts skip this step.

The Docker services belong to one Compose project named `formbricks`, so every checkout of this repo on a Mac shares one lab stack and one port `3000`. Run `lab:dev` from one checkout at a time.

With `lab:dev` running, in a second Devbox shell:

```sh
pnpm lab:smoke
```

`lab:smoke` runs Formbricks's own start-from-scratch Playwright scenario against the running app. At the pinned revision it can fail at sign-in: the scenario writes its user to Postgres and signs in at once, while Formbricks's background worker copies the user into the authorization store a second or more later. When it is sent to "create organization", that race is the cause, not the lab app. Formbricks's own CI runs the scenario against a production build.

After `Ctrl+C`, stop the Docker services:

```sh
pnpm lab:stop
```

`lab:stop` keeps the Docker volumes, so the data survives. There is no reset command, because deleting the volumes is destructive.
