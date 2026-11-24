# Recorder

How to record a flow in your app with the ayme recorder, hand the recording to your coding agent, and what the recorder does while it records.

The recorder is the `ayme-recorder` command of the npm package `@ayme-dev/cli`. You click through a flow in your app; the recorder writes down each step and what the step changed on the page, in a Recording Package. A coding agent then turns the package into Playwright page objects and a test, with the [`ayme-recorder` skill](coding-agent-skill.md#ayme-recorder). The [package's README](https://github.com/ayme-labs/ayme/blob/main/packages/cli/README.md) walks through a first recording, with pictures.

The commands below are written `npx ayme-recorder`, for a project that has `@ayme-dev/cli` in its `package.json`. Without it, run `npx @ayme-dev/cli` in its place.

## Before you start

- Run every command in your project's folder. That is where the recorder looks for Playwright, and where it saves recordings.
- The project needs `@playwright/test` (or `playwright`) installed, in the supported range below. The recorder brings no Playwright and no browser of its own.
- The project's Playwright needs Chromium: `npx ayme-recorder install` installs it.
- Recording works in Chromium only.

### Supported Playwright versions

The range is stated in [`playwright-range.json`](https://github.com/ayme-labs/ayme/blob/main/packages/recorder/playwright-range.json): `floor` is the oldest version the recorder starts on, and `lastVerified` the newest its tests have passed on.

- Older than `floor`: the recorder stops and names the range.
- Newer than `lastVerified`: it records, and prints a warning that it may miss or misread an input.
- No Playwright installed: it stops and says how to install it.

## Hand a flow to your coding agent

With the `ayme-recorder` skill installed, ask your agent to record a flow, and say where it starts:

> Record the checkout flow from http://localhost:3000 and write a Playwright test for it.

The agent runs `codegen` with that address. The browser opens with recording off; press **Record**, click through the flow, and press **Finish**. The agent reads the recording, proposes page objects and a test, and writes them once you agree.

You can also record first and hand the recording over after: run `codegen` yourself, and when you finish, ask the agent to turn the recording into a test with the `ayme-recorder` skill. The latest recording is always at `.ayme/recordings/latest.yaml`.

## Commands

`npx ayme-recorder --version` prints the installed version. It works only on its own, with no command or other flag. `npx ayme-recorder --help` prints every command and flag.

### `codegen <url>`

Opens `<url>` in Chromium, with a recorder window beside it and a small toolbar on the page. Recording is off at first, so you can log in or reach your starting point. Press **Record** to start.

```sh
npx ayme-recorder codegen http://localhost:3000
```

The terminal prints the address of the recorder window, such as `Recorder UI: http://127.0.0.1:52011/`. When the recording is saved it prints `Recording package: <path>`, or `Recording was empty; no recording package was created.` when there was nothing to save.

- `--headless`: open Chromium without a window. Open the printed window address in a browser to control the recording.
- `--start-recording`: open the recorder already recording, so that the recording and its trace hold the first page load, its network requests included. The page opens blank, the recorder starts recording, and only then does the page go to `<url>`. A click on the blank page before it loads, or an element picked there for **Assert visibility**, is not recorded. The recording's first Visit starts as soon as the browser commits to the page's document, before the page has finished loading: if you press **Stop** before that, the load is not in the recording, though its network requests can still be in the trace, which runs from the start. **Stop**, **Continue recording**, **Clear** and **Finish** work as they do after pressing **Record**; after **Clear**, the next recording starts from the page as it is then.
- `--load-storage <file>`: open the page with the cookies and local storage in `<file>`, a storage state file as Playwright writes it: one saved by `npx playwright codegen --save-storage`, by `--save-storage` here, or by your project's own login setup with `context.storageState()`. The recorder window gets none of it. If the file cannot be read, or holds no storage state object, the recorder does not start.
- `--save-storage <file>`: when the recorder ends, save the browser's cookies and local storage to `<file>`, in the same format, as `npx playwright codegen --save-storage` does.
  - Pressing **Finish**, closing the last page and pressing Ctrl+C in the terminal all save it. They save it also when nothing was recorded, so you can open the recorder only to log in and end it, and also when the recording itself fails, as when its package cannot be written.
  - Quitting the whole browser cannot save it, as its storage goes with it.
  - It is saved once the recording is over and its trace is stopped, thrown away or given up on, so nothing it does is recorded: to read the local storage of a site no page is open at, Playwright opens a page of its own for a moment.
  - If it cannot be saved, the recorder prints [a warning](#warnings).

### `codegen --cdp-endpoint <address>`

Records a Chromium that is already running, such as one you prepared by hand or one an automation script drives. Start that browser with its DevTools protocol open, for example with `--remote-debugging-port=9222`, and pass the address:

```sh
npx ayme-recorder codegen --cdp-endpoint http://127.0.0.1:9222
```

- The address is `http://` or `ws://`, on `localhost` or a `127.x.x.x` address. A browser on another machine is refused.
- The browser must have exactly one page open. The recorder records that page and does not navigate it.
- Input given by another automation client in that browser is recorded like a person's.
- When the recorder ends, it takes its toolbar off the page and leaves the browser open. Close the page or press Ctrl+C to end; either saves what was recorded, as **Finish** does.
- The recorder window does not open by itself: open the printed address in any browser.
- `--headless` and `--start-recording` do not apply here, and you cannot give a URL as well.
- `--load-storage` and `--save-storage` do not apply here either: the running browser's storage is its own, and saving it would open a page in it.

### `trace`

Opens a recording's trace with your project's own `npx playwright trace`:

```sh
npx ayme-recorder trace latest                    # the latest recording
npx ayme-recorder trace rec_20261113T195055354Z   # a recording by its id
npx ayme-recorder trace .ayme/recordings/rec_20261113T195055354Z/trace.zip
```

`trace open` works the same way, with `latest` or an id in place of the file. Any other `trace` command, such as `trace actions` or `trace snapshot`, is passed to `npx playwright trace` as it is. The trace is a standard Playwright trace, so `npx playwright trace` can also open it directly. It holds DOM snapshots and network requests, and no screenshots.

The trace's list of actions (`trace actions`) does not name your steps. It shows the recorder's own calls: its reads of the page, and the mouse events of the clicks it held back and sent on. Keys it held back show as key presses; other typed or pasted text is not an action there. To find a step, use the position numbers the package gives for it, as the [`ayme-recorder` skill](https://github.com/ayme-labs/ayme/blob/main/skills/ayme-recorder/SKILL.md#use-the-trace) describes.

### `install`

Installs a browser with your project's own Playwright, as `npx playwright install` does: Chromium unless you name another. Its flags, such as `--with-deps`, are passed on.

```sh
npx ayme-recorder install
```

## Record a flow

The recorder window has every control. The toolbar on the page has the button that records, stops and continues, and **Assert visibility**. Both always show the same state. Use whichever is closer.

- **Record** starts recording. A Visit appears for the page as it is. The button turns to **Stop** only once the recorder really records: for a moment after you press **Record**, or **Continue recording**, it still shows the state before. Wait for it before your first step; input given before it is not recorded.
- **Stop** pauses. While paused, your input reaches the page and is not recorded, and neither is what the page changes meanwhile: after **Continue recording**, changes are counted from the page as it stood then. The button reads **Continue recording** once recording has really stopped; a click you make before that is still recorded. Text you were typing keeps its last text.
- **Continue recording** resumes in the same recording.
- **Assert visibility** lets you click an element to record "this must be visible". An outline shows the element under the mouse that a click would pick. That click does not reach your app. The button stays on until you click an element or press it again.
- **Clear** throws away everything recorded so far, so you can start over. **Record** works again once the old trace is gone.
- **Finish** saves the recording, including your last step, without pressing **Stop** first. Pressing it twice saves once.

While the recorder finishes a step, the window says **Wrapping up**, the toolbar shows a spinner, and the buttons wait.

### What the window shows

The window's title names the page that is open. The window lists each Visit, one per page load, with its steps. A change of only the address's query or hash stays in the same Visit.

- Text you type, a choice in a dropdown and a file upload show as a step while you make them, usually at your first key. The step's text follows every key, and what it changed catches up each time the recorder reads the page.
- Under each step, the window lists what changed: the elements that appeared, were removed or changed, and for a changed element its old and new values. Each element is named by its role and name, such as `button "Save"`, with more words when that alone would fit other elements on the page too.
- Three or more elements of one role that appeared in or were removed from the same named element, such as the items of a list, show as one row that counts them and says where they went, as `30 listitems` with `25 removed from, 5 appeared in "Issues"`. Expand it to see each of them.
- An element whose only change is the text cursor gets no row. The saved package keeps every change either way.
- Changes that no step of yours explains, such as a banner that loaded late, show as a row of their own.
- Hover the element a step acted on, or the element of a row of what changed, to highlight it on the page. Hovering a step's element also shows its selector in Playwright's own words, such as `getByRole('button', { name: 'Save' })`. On a page you have left, or when the page no longer has the element, everything on the page as it is now that matches lights up, so look-alikes do too.

### Leave steps out

From **Record** until you press **Finish** or **Clear**, every step, and every change no step of yours explains, has a **Discard** button, which shows while you hover the row. You do not need to press **Stop** first, so a wrong click costs one press.

- A discarded row stays in place, struck through, with its changes hidden. Its **Restore** button, an undo icon, brings it back.
- The saved package keeps only a stub of a discarded row, which tells the agent to leave it out.
- Discarding a step does not put the page back: what you do next is recorded from the page as it is.
- A step you discard while you still type it stays discarded, and its text goes on following your keys.
- Your choices survive **Stop** and **Continue recording**, are saved by **Finish**, and are dropped by **Clear**.
- Discarding a click that left the page keeps the next page's Visit.
- A recording in which you discarded everything still saves.

## End a recording

To end, press **Finish**, close the browser, or press Ctrl+C in the terminal. Closing the browser or pressing Ctrl+C while recording or paused saves what was recorded so far, as **Finish** does; before you press **Record** there is nothing to save. Pressing Ctrl+C a second time does not cut the save short.

Ending always finishes. If the browser stops answering, the recorder waits a few seconds for the steps still under way, leaves out those that are not complete, and saves the rest. If the trace cannot be written either, it gives up waiting after a minute and saves the package without its trace. If nothing was recorded, it ends with nothing saved. With `--save-storage`, it then waits at most half a minute for the storage state, and prints [a warning](#warnings) if it was not saved.

## Record a logged-in app

The recorder keeps no login of its own: each `codegen <url>` opens a browser with no cookies and no local storage unless you load some with `--load-storage`, and nothing of it is kept when the recorder ends unless you save it with `--save-storage`. To record an app you must be logged in to, do one of these:

- Log in in the recorded page before you press **Record**: recording is off at first, and nothing you do before **Record** is recorded.
- Load a login saved before with `--load-storage <file>`. Save one with `--save-storage <file>`, by logging in and ending the recorder, or with `npx playwright codegen --save-storage <file>`, or use the file your project's login setup writes.
- Record a browser that is already logged in, with `codegen --cdp-endpoint <address>`.

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

The package lists each Visit with its steps and what each changed, by the page's structure. The [`ayme-recorder` skill](https://github.com/ayme-labs/ayme/blob/main/skills/ayme-recorder/SKILL.md#read-the-package) describes every field.

The first save writes `.ayme/.gitignore`, so recordings stay out of your commits. If the project already has a `.ayme/.gitignore`, the recorder leaves it as it is. A package is written under a temporary name and renamed when complete, so you find either a whole package or none.

## Warnings

The command prints these as `Warning: …` while it records. The recording goes on.

- **Playwright is newer than the recorder is verified on.** See [Supported Playwright versions](#supported-playwright-versions).
- **Playwright's report of an input does not have the shape of a snapshot**, or **a page could not be read when typing, a choice or an upload was reported on it.** That input is recorded with what changed up to its end only, not with what changed before it.
- **Typing, a choice, an upload or an assertion is not recorded: its page could not be read.**
- **The names of the files chosen could not all be read.** The upload is recorded with the first file name only. This happens when the file input is gone by the time the recorder reads it.
- **The project's `playwright trace` could not number the trace's snapshots.** The package has its trace, but not the position numbers that open the snapshot of each step.
- **The storage state could not be saved.** `--save-storage` could not write its file, the browser was quit or did not answer within half a minute, or the recorder broke down while it saved. The recording ends as it would have without the save: saved, empty, or failed. This one comes as the recorder ends.

When the recorder cannot start, it prints one sentence saying why, and exits with code 1. It does not start when:

- no Playwright is installed, or it is too old, or no Playwright recorder is found in that version,
- Chromium could not be opened or reached,
- the `--cdp-endpoint` address is not on this machine, or the running browser has no page or more than one,
- the `--load-storage` file cannot be read or holds no storage state object,
- the recorder window could not be served.

## Limits

- **A pause is still traced.** The trace runs from the first **Record** to **Finish**, with DOM snapshots and network requests throughout, including what was on the page while paused. What you type while paused can show in those snapshots, so do not type a secret while paused and expect it to be left out.
- **Closing the page right after your last click can lose that click.** The recorder holds each click back for a moment to read the page first; if the page is gone by then, the click is dropped. If the click reached the page but Playwright had not reported it yet, the recorder then takes about five seconds to end.
- **A double click can reach the page as a single click.** It happens when the recorder sends your first click on at the very moment you press the button the second time, which a page that is slow to read or a busy machine makes more likely.
- **The first key after Record is held back and sent again,** as is anything typed while an earlier input is held back. Sending again is less faithful for paste and for input methods that compose text.
- **Typing in a field the page moved the focus to by itself can have its changes listed under the field before it,** as in a verification code with one box per character, when you type into the next box before the page was quiet. So can typing right after a choice in a dropdown or an upload, before the page was quiet: the change of its first key can be listed under the choice or the upload.
- **Cross-origin iframes and transformed iframes were not tested.** Same-origin iframes and open shadow roots are.
- **On very large pages, clicks, the first key after Record or after the page went to another page, and the recorder window lag while the recorder reads the page.** It takes 10 to 40 ms on ordinary pages, and about a second on a page with tens of thousands of elements, such as the Wikipedia article "World War II".
