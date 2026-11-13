# Recorder fixture

The end-to-end tests of the Recorder and the fixture pages they record. It is
private and never published.

```
app/         the fixture pages
tests/       the shared fixtures (fixtures.ts) and one spec per concern
```

This folder is also the project the recorder runs in: it has Playwright
installed, and the tests start the built `ayme-recorder` command here as a
child process, as a developer would in their own project. The recorder loads
this project's Playwright; the command brings none of its own.

Each test serves the fixture pages on a free port (`fixturePages`), so it can
see which requests the recorder's browser made, and runs the command with
`runRecorder`. Assertions go through what the command prints, its exit code and
those requests. Add a spec file for a new concern and reuse `fixtures.ts`.

Two environment variables exist for these tests, and `runRecorder` sets both:

- `AYME_RECORDER_HEADLESS=1` launches the browser without a window, since the
  tests run where there is no screen.
- `AYME_RECORDER_DEBUG_PORT=<port>` also opens the browser's DevTools protocol
  on that local port, so a test can act in the recorded browser over a
  connection of its own, as the person would: `run.closePage(url)` closes a
  page through it.

## Running

Run from this directory inside the repository's Devbox shell. `pnpm test:e2e`
tests the built packages, so build first; Turbo's `test:e2e` task does.
