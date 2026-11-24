# @ayme-dev/cli

The ayme Recorder. You click through a flow in your app; the recorder writes down what you did and what each step changed on the page. A coding agent then turns that Recording Package into Playwright page objects and a test, with the [`ayme-recorder` skill](https://github.com/ayme-labs/ayme/blob/main/skills/ayme-recorder/SKILL.md).

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

`npx @ayme-dev/cli --version` prints the installed version.

### `codegen <url>`

Opens `<url>` in Chromium, with a recorder window beside it and a small toolbar on the page. Recording is off at first, so you can log in or reach your starting point. Press **Record** to start.

```sh
npx @ayme-dev/cli codegen http://localhost:3000
```

The terminal prints the address of the recorder window, such as `Recorder UI: http://127.0.0.1:52011/`. When the recording is saved it prints `Recording package: <path>`, or `Recording was empty; no recording package was created.` when there was nothing to save.

- `--headless`: open Chromium without a window. Open the printed window address in a browser to control the recording.
- `--start-recording`: open the recorder already recording, so that the recording and its trace hold the first page load, its network requests included. The recording's first Visit starts as soon as the browser commits to the page's document, before the page has finished loading: if you press **Stop** before that, the load is not in the recording, though its network requests can still be in the trace, which runs from the start. A click on the blank page before it loads, or an element picked there for **Assert visibility**, is not recorded. The page opens blank, the recorder starts recording, and only then does the page go to `<url>`. **Stop**, **Continue recording**, **Clear** and **Finish** work as they do after pressing **Record**; after **Clear**, the next recording starts from the page as it is then.

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
- `--headless` and `--start-recording` do not apply here, and you cannot give a URL as well.

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

The recorder window has every control. The toolbar on the page has the button that records, stops and continues, and **Assert visibility**. Both always show the same state. Use whichever is closer.

- **Record** starts recording. A Visit appears for the page as it is. The button turns to **Stop** only once the recorder really records: for a moment after you press Record, or Continue recording, it still shows the state before. Wait for it before your first step; input given before it is not recorded.
- **Stop** pauses. While paused, your input reaches the page and is not recorded, and neither is what the page changes meanwhile: after Continue recording, changes are counted from the page as it stood then. The button reads **Continue recording** once recording has really stopped; a click you make before that is still recorded. Text you were typing keeps its last text.
- **Continue recording** resumes in the same recording.
- **Assert visibility** lets you click an element to record "this must be visible". An outline shows the element under the mouse that a click would pick. That click does not reach your app. The button stays on until you click an element or press it again.
- **Clear** throws away everything recorded so far, so you can start over. Record works again once the old trace is gone.
- **Finish** saves the recording, including your last step, without pressing Stop first. Pressing it twice saves once.

While the recorder finishes a step, the window says **Wrapping up**, the toolbar shows a spinner, and the buttons wait.

The window's title names the page that is open. The window lists each Visit (one per page load; a change of only the address's query or hash stays in the same Visit) with its steps. Text you type or paste, a choice in a dropdown and a file upload show as a step as soon as Playwright reports them, usually at your first key; after the first key after Record, the first key after the page went to another page (by a click, the browser's Back button or a redirect; a change of only the address's query or hash keeps the page), right after a click whose page still changes, or in a field the page moved the focus to by itself, a step shows once the recorder has read the page. The step's text follows every key. What it changed catches up each time the recorder reads the page: once the page has been quiet for a quarter of a second, or about every two seconds while you keep typing. Your next action makes the step final, except that the focus your click's press moves can still go from the step's changes to the click's; and a key Playwright reports only after your next action still sets the step's text, while the page stays at its document: a change of only the address's query or hash, as a search field that writes your text into the address at each key, keeps it. Once the page has gone to another document, typing Playwright reports as more of that step is a step of its own on the new page. When typing makes the page navigate, as a code field that submits itself on its last digit, or the page closes, a fill's changes go up to the last read of its own page. Under each step it lists what changed: the elements that appeared, were removed or changed, and for a changed element its old and new values. Three or more elements of one role that appeared in or were removed from the same named element, such as the items of a list, show as one row that counts them and says where they went, as `30 listitems` with `25 removed from, 5 appeared in "Issues"`; expand it to see each of them. Two lists of the same name are kept apart. An element whose only change is its cursor gets no row. The saved package keeps every change either way. The window names each element so that the name, looked up as Playwright looks up a locator of the same words, matches that element alone on its page: by its role and name, as `button "Save"`; when other elements share those, with the text inside it, as `listitem "buy milk"`; when that is not enough, inside the nearest element whose name fits it alone, as `listitem "buy milk" › checkbox "Toggle Todo"`; and as a last resort by its place among what the name matches, as `checkbox "Toggle Todo" (2nd of 3)`. A role's name, and the text of an element that has nothing but text, match exactly; the text inside matches part of an element's text, in any case, so `listitem "buy milk"` also counts an item that reads "Buy milk today". An element inside a frame is counted in the frame's page. A button or a link is written with its name whether the name is its text or only a label for an icon, so a text that might be such a name names no element: an item with that text is named by its place, as `listitem (2nd of 2)`. An element with no role and no name, and none around it, is named by the text inside it, quoted. A removed element is named as the page before the change had it, and any other as the page after it. Changes that no step of yours explains, such as a banner that loaded late, show as a row of their own, unless they are left with no row to show. Hover the element a step acted on, next to the step's name, or the element of a row of what changed, to highlight it on the page. On the page you are still on, exactly that element lights up; for a step on an element the page's structure does not list, such as an icon, what the step's selector matches lights up. On a page you have left, or when the page no longer lists the element, every element of the page as it is now that its name, or a step's selector, matches lights up, so look-alikes all do. Hovering the element a step acted on also shows its selector, in Playwright's own words, such as `getByRole('button', { name: 'Save' })`; the package keeps the selector itself. An element you can hover has a border and a crosshair cursor, which it loses when hovering it finds nothing on the page as it is then; it keeps its size either way. A step whose element the recorder could not tie to the page's structure is named by its selector: as `link "Save"` for a role and a name, and otherwise in Playwright's own words, as `getByText('Saved')`; as `element` when Playwright has no words for it. Its raw selector then shows on hover. This works for the steps of earlier pages too, when the page still has the element.

### Leaving steps out

From Record until you press Finish or Clear, every step, and every change no step of yours explains, has a **Discard** button, so a wrong click costs one press and no Stop. A discarded row stays in place, dimmed, and the saved package keeps only a stub of it, which tells the agent to leave it out. **Restore** brings it back. Discarding a step does not put the page back: what you do next is recorded from the page as it is. A step you discard while you still type it stays discarded, and its text goes on following your keys. Your choices survive Stop and Continue recording, are saved by Finish, and are dropped by Clear. Discarding a click that left the page keeps the next page's Visit. A recording in which you discarded everything still saves.

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

The package lists each Visit with its steps and what each changed, by the page's structure. A step names the element it acted on by a ref and a selector; an Assert visibility step names the element you picked. A click on the text or an icon inside a link or a button names the link or the button. A right-click and a middle click are steps of their own, "Right-click" and "Middle-click" in the window, with the button in the package. A middle click on a checkbox or a radio is a "Middle-click" too, which checks nothing, though Playwright reports it as a check. The focus a click's press moves to the clicked element shows with that click's changes, not as a row before it nor under the step before it, such as the typing just before the click; a page's first click is the exception that [Known limits](#known-limits) describes. A key pressed while nothing on the page had focus has a selector and no ref: it goes to the page's body, which the page structure does not list. A step's time is when its input reached the page, and the end of its place in the trace is when the page was read after it. The skill describes every field.

The first save writes `.ayme/.gitignore`, so recordings stay out of your commits. If the project already has a `.ayme/.gitignore`, the recorder leaves it as it is. A package is written under a temporary name and renamed when complete, so you find either a whole package or none.

## Warnings

The command prints these as `Warning: …` while it records. The recording goes on.

- **Playwright is newer than the recorder is verified on.** See [Supported Playwright versions](#supported-playwright-versions).
- **Playwright's report of an input does not have the shape of a snapshot.** That typing, select or upload is recorded with what changed up to its end only, not with what changed before it.
- **The names of the files chosen could not all be read.** The upload is recorded with the first file name only. This happens when the file input is gone by the time the recorder reads it.
- **The project's `playwright trace` could not number the trace's snapshots.** The package has its trace, but not the position numbers that open the snapshot of each step.

When the recorder cannot start, it prints one sentence saying why, and exits with code 1: no Playwright installed, Playwright too old, no Playwright recorder found in that version, Chromium could not be opened or reached, the `--cdp-endpoint` address is not on this machine, the running browser has no page or more than one, or the recorder window could not be served.

## Known limits

- **A pause is still traced.** The trace runs from the first Record to Finish, with DOM snapshots and network requests throughout, including what was on the page while paused. What you type while paused can show in those snapshots, so do not type a secret while paused and expect it to be left out. The trace holds no screenshots.
- **Closing the page right after your last click can lose that click.** The recorder holds each click back for a moment to take a snapshot first; if the page is gone by then, the click is dropped. If the click reached the page but Playwright had not reported it yet, the recorder then takes about five seconds to end: it waits for that report until its time limit.
- **A double click can reach the page as a single click.** It happens when the recorder sends your first click on at the very moment you press the button the second time, which a page that is slow to snapshot or a busy machine makes more likely.
- **The first key after Record is held back and sent again,** as is anything typed while an earlier input is held back. Sending again is less faithful for paste and for input methods that compose text.
- **An upload whose file input is gone when it is read keeps only its first file name,** with a warning.
- **An element the page structure does not list, which becomes two identical siblings, can be matched to the wrong one** in the next steps.
- **Cross-origin iframes and transformed iframes were not tested.** Same-origin iframes and open shadow roots are.
- **The toolbar is part of the trace.** Its element stays in the trace's page snapshots, empty.
- **Highlighting an element from the window, and picking one for Assert visibility, add actions to the trace.** The position numbers in the package stay right.
- **Highlighting a step of a page you have left lights up every element of the page, as it is now, that matches.** Its element is looked for by its selector, and a change row's element by its name, which Playwright looks up as a locator of the same words, in a frame too; so is an element the page you are on no longer lists. Every element either matches lights up: a name that fit one element when it was read can match more on the page as it is now. A page that was closed highlights nothing.
- **Highlighting a change row can light up nothing, or a look-alike, when the page holds hidden text** and the row's element is looked up by its name, as on a page you have left. A list item or a paragraph is named by the text inside it as the page structure reads it, which leaves out hidden text, such as a span with `hidden` or `display: none`. Playwright matches that name against all of each element's text, so hidden text in the element, or in one like it, changes what matches.
- **The outline drawn while Assert visibility is on is part of the trace** while it shows, as its element in the page snapshots, like the toolbar.
- **The recorded page's own scripts can reach the toolbar's function** on the page, as any script the page runs can.
- **A click that Playwright reports as caused by a key press,** such as Enter on a button, is not recorded as its own step: the key press is.
- **When the recorder stops waiting, inputs it still held back are sent on together** and can reach the page out of order. This happens only when ending or pausing runs out of time, after about five seconds, with several inputs held.
- **A click that reached the page but has no "after" when that time runs out is not recorded,** even if Playwright reported it. Typing, a choice or an upload that already showed as a step is kept, with the changes it showed so far.
- **Typing in a field the page moved the focus to by itself can have its changes listed under the field before it,** as in a verification code with one box per character, when you type into the next box before the page was quiet. So can typing right after a choice in a dropdown or an upload, before the page was quiet: the change of its first key can be listed under the choice or the upload.
- **The first click on a page can leave out the focus its press moved** when another element, such as a field the page focused by itself, had the focus: the recorder first reads a page at its first step, after that click's press.
- **On very large pages, clicks, the first key after Record or after the page went to another page, and the recorder window lag while the recorder reads the page.** It takes 10 to 40 ms on ordinary pages, and about a second on a page with tens of thousands of elements, such as the Wikipedia article "World War II".
- **Recording is Chromium only.**
