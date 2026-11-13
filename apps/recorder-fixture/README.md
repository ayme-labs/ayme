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
see which requests the recorder's browser made. Add a spec file for a new
concern and reuse `fixtures.ts`.

- `codegen.spec.ts` runs the command with `runRecorder`. Assertions go through
  what the command prints, its exit code and those requests.
- `recording.spec.ts` records. While the recorder has no window, the command
  has no way to press Record or Finish, so these tests start the engine in the
  test's own process with `startRecording` and press both through its handle.
  The project is a folder of the test's own inside this app, which is where
  the package is saved. Input is a person's: `person` sends raw input events
  over the test's own connection to the browser, so it is no call of the
  Playwright that records. Assertions read the Recording Package from disk.
  `tests/expected/` holds expected package text; `cart.package.txt` is what
  the throwaway prototype of pull request #1268 wrote for the same clicks,
  with what differs from run to run replaced.

- `attach.spec.ts` records a running browser: `runningBrowser` launches one
  with its page open before the recorder comes, and its connection is another
  automation client in that browser. `recordedBrowser: "attach"` has
  `startRecording` attach to such a browser instead of launching one.

- `controls.spec.ts` stops, continues, clears and finishes a recording, the
  same way: through the engine's handle, with a person's input, reading the
  package from disk.

- `trace.spec.ts` opens a recording's trace with the stock `playwright trace`
  of the project's own Playwright (`stockTrace.ts`), as a reader does: by the
  position numbers the package gives, and through `ayme-recorder trace
latest`, a recording id and a path. `stockTrace.ts` names the flag that picks
  a snapshot's phase by the installed version: `--name` on Playwright 1.62,
  `--phase` from 1.63.

- `inputs.spec.ts` records every kind of input on `app/inputs.html` the same
  way: typing, key presses, a native select, a file upload, a double click,
  and clicks inside a frame, an open shadow root and on an element the page
  structure does not list.

Two environment variables exist for these tests, and `runRecorder` sets both:

- `AYME_RECORDER_HEADLESS=1` launches the browser without a window, since the
  tests run where there is no screen.
- `AYME_RECORDER_DEBUG_PORT=<port>` also opens the browser's DevTools protocol
  on that local port, so a test can act in the recorded browser over a
  connection of its own, as the person would: `run.closePage(url)` closes a
  page through it.

The Playwright project `attach` runs the first test of `recording.spec.ts`
again on a running browser the recorder attaches to; the project `launch`
runs every test.

`recording.spec.ts` runs on another Playwright version when
`AYME_RECORDER_PLAYWRIGHT_PROJECT` names a project folder with that version
installed: each test's project is then a folder inside that one, so the
recorder finds that Playwright. CI runs the first test of that file this way
once per supported version, in both projects; the range is in
[`packages/recorder/playwright-range.json`](../../packages/recorder/playwright-range.json).

## Running

Run from this directory inside the repository's Devbox shell. `pnpm test:e2e`
tests the built packages, so build first; Turbo's `test:e2e` task does.
