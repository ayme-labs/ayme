# @ayme-dev/cli

The Ayme Recorder. You click through a flow in your app; the recorder writes down what you did and what each step changed on the page. A coding agent then turns that Recording Package into Playwright page objects and a test, with the [`ayme-recorder` skill](https://github.com/ayme-labs/ayme/blob/main/skills/ayme-recorder/SKILL.md).

The recorder runs on the Playwright your project already has. It brings no Playwright and no browser of its own.

```sh
npx @ayme-dev/cli codegen http://localhost:3000
```

The command is called `ayme-recorder`. When the package is in your project's `package.json`, run `npx ayme-recorder` in place of `npx @ayme-dev/cli`.

## Before you start

- Run every command in your project's folder. That is where the recorder looks for Playwright, and where it saves recordings.
- The project needs `@playwright/test` (or `playwright`) installed, in the supported range below, and Chromium for it: `npx @ayme-dev/cli install` installs it.
- Recording works in Chromium only.

### Supported Playwright versions

The range is stated in [`playwright-range.json`](https://github.com/ayme-labs/ayme/blob/main/packages/recorder/playwright-range.json): `floor` is the oldest version the recorder starts on, and `lastVerified` the newest its tests have passed on.

- Older than `floor`: the recorder stops and names the range.
- Newer than `lastVerified`: it records, and prints a warning that it may miss or misread an input.
- No Playwright installed: it stops and says how to install it.

## Commands

### `codegen <url>`

Opens `<url>` in Chromium, with a recorder window beside it and a small toolbar on the page. Recording is off at first, so you can log in or reach your starting point. Press **Record** to start.

```sh
npx @ayme-dev/cli codegen http://localhost:3000
```

The terminal prints the address of the recorder window, such as `Recorder UI: http://127.0.0.1:52011/`. When the recording is saved it prints `Recording package: <path>`, or `Recording was empty; no recording package was created.` when there was nothing to save.

- `--headed`: open Chromium with a visible window. This is the default.
- `--headless`: open Chromium without a window. Open the printed window address in a browser to control the recording.

To end, press **Finish**, close the browser, or press Ctrl+C in the terminal. Closing the browser or pressing Ctrl+C while recording or paused saves what was recorded so far, as Finish does; before you press Record there is nothing to save. Pressing Ctrl+C a second time does not cut the save short.

Ending always finishes. If the browser stops answering, the recorder waits a few seconds for the steps still under way and leaves out those that are not complete, then saves the rest. If the trace cannot be written either, it gives up waiting after a minute and saves the package without its trace. If nothing was recorded, it ends with nothing saved.

### `codegen --cdp-endpoint <address>`

Records a Chromium that is already running, such as one you prepared by hand or one an automation script drives. Start that browser with its DevTools protocol open, for example with `--remote-debugging-port=9222`, and pass the address:

```sh
npx @ayme-dev/cli codegen --cdp-endpoint http://127.0.0.1:9222
```

- The address is `http://` or `ws://`, on `localhost` or a `127.x.x.x` address. A browser on another machine is refused.
- The browser must have exactly one page open. The recorder records that page and does not navigate it.
- Input given by another automation client in that browser is recorded like a person's.
- When the recorder ends, it takes its toolbar off the page and leaves the browser open. Close the page or press Ctrl+C to end; either saves what was recorded, as Finish does.
- The recorder window does not open by itself: open the printed address in any browser.
- `--headless` and `--headed` do not apply here, and you cannot give a URL as well.

### `trace`

Opens a recording's trace with your project's own `npx playwright trace`:

```sh
npx @ayme-dev/cli trace latest                    # the latest recording
npx @ayme-dev/cli trace rec_20261113T195055354Z   # a recording by its id
npx @ayme-dev/cli trace .ayme/recordings/rec_20261113T195055354Z/trace.zip
```

`trace open` works the same way, with `latest` or an id in place of the file. Any other `trace` command, such as `trace actions` or `trace snapshot`, is passed to `npx playwright trace` as it is. The trace is a standard Playwright trace, so `npx playwright trace` can also open it directly.

The trace's list of actions (`trace actions`) does not name your steps. It shows the recorder's own calls: its reads of the page, and the mouse events of the clicks it held back and sent on. Keys it held back show as key presses; other typed or pasted text is not an action there. To find a step, use the position numbers the package gives for it, as the [`ayme-recorder` skill](https://github.com/ayme-labs/ayme/blob/main/skills/ayme-recorder/SKILL.md#use-the-trace) describes.

### `install`

Installs a browser with your project's own Playwright, as `npx playwright install` does: Chromium unless you name another. Its flags, such as `--with-deps`, are passed on.

```sh
npx @ayme-dev/cli install
```

## Recording a flow

The recorder window and the toolbar on the page have the same controls and always show the same state. Use whichever is closer.

- **Record** starts recording. A Visit appears for the page as it is. The status says **Recording** only once the recorder really records: for a moment after you press Record, or Continue, it still shows the state before. Wait for it before your first step; input given before it is not recorded.
- **Stop** pauses. While paused, your input reaches the page and is not recorded, and neither is what the page changes meanwhile: after Continue, changes are counted from the page as it stood then. The status shows **Paused** once recording has really stopped; a click you make before that is still recorded. Text you were typing appears as a step when **Paused** shows, not when you press Stop: the recorder waits until the text can no longer change.
- **Continue** resumes in the same recording.
- **Assert visibility** lets you click an element to record "this must be visible". That click does not reach your app. The button stays on until you click an element or press it again.
- **Clear** throws away everything recorded so far, so you can start over. Record works again once the old trace is gone.
- **Finish** saves the recording, including your last step, without pressing Stop first. Pressing it twice saves once.

While the recorder finishes a step, the status says **Wrapping up** and the buttons wait.

The window lists each Visit (one per page load) with its steps. Under each step it lists what changed: the elements that appeared, were removed or changed. Changes that no step of yours explains, such as a banner that loaded late, show as a row of their own. Hover the element a step acted on, next to the step's name, to highlight it on the page.

### Leaving steps out

While paused, every step and every change row has a **Discard** button. A discarded row stays in place, dimmed, and the saved package keeps only a stub of it, which tells the agent to leave it out. **Restore** brings it back. Your choices survive Continue, are saved by Finish, and are dropped by Clear. Discarding a click that left the page keeps the next page's Visit. A recording in which you discarded everything still saves.

## Where recordings are stored

```text
.ayme/
  .gitignore                     recordings/ and .gitignore itself
  recordings/
    latest.yaml                  a copy of the latest package
    rec_<time>/
      package.yaml               the Recording Package
      trace.zip                  the Playwright trace of the recording
```

The package lists each Visit with its steps and what each changed, by the page's structure. A step names the element it acted on by a ref and a selector. Two kinds of step have a selector and no ref: an Assert visibility step, and a key pressed while nothing on the page had focus, which goes to the page's body, which the page structure does not list. A step's time is when its input reached the page, and the end of its place in the trace is when the page was read after it. The skill describes every field.

The first save writes `.ayme/.gitignore`, so recordings stay out of your commits. If the project already has a `.ayme/.gitignore`, the recorder leaves it as it is. A package is written under a temporary name and renamed when complete, so you find either a whole package or none.

## Warnings

The command prints these as `Warning: …` while it records. The recording goes on.

- **Playwright is newer than the recorder is verified on.** See [Supported Playwright versions](#supported-playwright-versions).
- **Playwright's report of an input does not have the shape of a snapshot.** That typing, select or upload is recorded with what changed up to its end only, not with what changed before it.
- **The names of the files chosen could not all be read.** The upload is recorded with the first file name only. This happens when the file input is gone by the time the recorder reads it.
- **The project's `playwright trace` could not number the trace's snapshots.** The package has its trace, but not the position numbers that open the snapshot of each step.

When the recorder cannot start, it prints one sentence saying why, and exits with code 1: no Playwright installed, Playwright too old, no Playwright recorder found in that version, Chromium could not be opened or reached, the `--cdp-endpoint` address is not on this machine, the running browser has no page or more than one, or the recorder window could not be served.

## Known limits

- **A pause is still traced.** The trace runs from the first Record to Finish, with screenshots of the page throughout, including what was on screen while paused. What you type while paused can show in those screenshots and in the snapshots, so do not type a secret while paused and expect it to be left out.
- **Closing the page right after your last click can lose that click.** The recorder holds each click back for a moment to take a snapshot first; if the page is gone by then, the click is dropped.
- **The first key after Record is held back and sent again,** as is anything typed while an earlier input is held back. Sending again is less faithful for paste and for input methods that compose text.
- **On Playwright 1.63, a click in the last half-second before "Paused" shows can be lost.** Playwright waits a moment to see whether a double click follows, and this version cannot be asked to report the click sooner.
- **An upload whose file input is gone when it is read keeps only its first file name,** with a warning.
- **An element the page structure does not list, which becomes two identical siblings, can be matched to the wrong one** in the next steps.
- **Cross-origin iframes and transformed iframes were not tested.** Same-origin iframes and open shadow roots are.
- **The toolbar is part of the trace.** Its element stays in the trace's page snapshots, empty, and the toolbar can show in the trace's screenshots.
- **Highlighting an element from the window adds actions to the trace.** The position numbers in the package stay right.
- **The recorded page's own scripts can reach the toolbar's function** on the page, as any script the page runs can.
- **A click that Playwright reports as caused by a key press,** such as Enter on a button, is not recorded as its own step: the key press is.
- **The window's change rows say what appeared, was removed or changed, but not the old and the new value.** The package has the full picture.
- **An Assert visibility step has no ref for its element, only a selector.** Playwright reports the element it picked by a selector alone.
- **When the recorder stops waiting, inputs it still held back are sent on together** and can reach the page out of order. This happens only when ending or pausing runs out of time, after about five seconds, with several inputs held.
- **A click that reached the page but has no "after" when that time runs out is not recorded,** even if Playwright reported it.
- **Recording is Chromium only.**
