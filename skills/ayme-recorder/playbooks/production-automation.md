# Playbook: production automation

The result is a deterministic, parameterised Playwright automation of a flow
the user does on a third-party web portal, often a production system they do
not own, and a replay test that lets you fix its waits and locators without
touching the real backend. Some steps are irreversible: a final "Confirm" can
create a real contract. Only the user approves one.

Keep real data out of version control: parameter files, recordings, run
traces and the login state. Put them under `.ayme/` and check that git
ignores it: `git check-ignore -q .ayme/x` must succeed; add `.ayme/` to
`.gitignore` when it fails. The `trace` commands extract a recording into
`.playwright-cli/`: ignore it too.

## Steps

1. **Record** cold. The skill's Record step sends you here before it starts
   the recorder. Tell the user: once the recorder window shows the start
   page, log in if needed, then clear what the site keeps for itself but keep
   the login. In DevTools, open Application → Storage, untick Cookies, and
   Local storage too when the site keeps its login there, and press "Clear
   site data". Then reload the start page and do the flow.
   Otherwise the site answers from its own caches, and the recording lacks
   those calls. When the user does the flow to the end, irreversible steps
   included, the replay test covers them too.
2. **Analyze** the package and its trace, as
   [Read the package](../SKILL.md#read-the-package) and
   [Use the trace](../SKILL.md#use-the-trace) say. List the calls with
   `trace requests` and read each one in full with `trace request <n>`.
   Classify each call as a read or a permanent change from the evidence: the
   method, the URL or action name, the request body, the response, and what
   changed on the page right after it. The method alone does not decide it:
   reads can be POSTs, and GETs can change state. Done when every call the
   flow makes is classified.
3. **Align** with the user before you write code. Settle:
   - the steps of the flow;
   - the page objects;
   - the irreversible steps: propose those the permanent changes from step 2
     point to, and take the list the user confirms; there can be several;
   - for each, the values a person checks before it, such as customer, offer
     and price;
   - the parameters: the data a real run enters, and the value the recording
     used for each, as its requests carry it rather than as the user typed it;
   - the `confirm` the entry script uses, as [Confirm](#confirm) says;
   - on a site with a login, how a run gets one, as
     [Write the code](#write-the-code) says.

   Done when the user has confirmed each.

4. **Write** the code, as [Write the code](#write-the-code) says.
5. **Write the replay test**, as [The replay test](#the-replay-test) says.
6. **Heal** against the replay test. Run it with
   `npx playwright test <file> --repeat-each 3 --retries 0 --workers 1` and
   fix the page objects' locators and waits, never the flow's steps. When
   passing would take other steps, stop and tell the user. Keep the waits
   Page object design asks for, such as an action finishing in its target
   state. Prove each other wait: take it out and run three times at recorded
   speed, then three times with `REPLAY_SPEED=1000`. A wait that matters
   fails or flakes without it at either speed: put it back. Remove one that
   passes both. Done when the test passes three runs in a row with every
   wait proven.
7. **Rehearse live** with fresh real data the user gives you for one run,
   written to `.ayme/params/<flow>.<date>.json`. Run the entry script headed,
   with the user watching. The user answers each confirm: yes lets the same
   run make the real submission, no stops it. With the terminal prompt, the
   user starts the command in their own terminal, since its prompt reads from
   the terminal that started it. You never approve an irreversible step: a
   live run the user does not watch uses a `confirm` that returns `false`.
   When a run fails, read its trace in `.ayme/runs/` with `trace open`,
   `trace actions` and `trace snapshot`, fix the code, run the replay test
   again until it passes three times, and rehearse with new data.
8. **Hand over**: the command for a real run, where the files are, and what
   the replay test does not cover, such as steps the recording does not
   reach or calls it aborted on every run.

Done when a live rehearsal has run without failing and the user has the
hand-over.

## Write the code

Write plain Playwright page objects by
[Page object design](../references/page-object-design.md) and
[Write page objects from the recording](../SKILL.md#write-page-objects-from-the-recording),
with no Ayme decorators. Each irreversible step is its own page object
action.

The flow is one function, `run<Flow>(page, params, { confirm })`. Before each
irreversible step it reads the agreed values back from the page through the
page objects and asks `confirm`. When that returns `false`, the flow stops
before the step and returns where it stopped:

```ts
export type Confirm = (step: {
  name: string;
  summary: Record<string, string>;
  page: Page;
}) => Promise<boolean>;

export async function runContract(
  page: Page,
  params: ContractParams,
  { confirm }: { confirm: Confirm }
) {
  const form = await new ContractPage(page).open();
  const review = await form.fill(params);
  const summary = await review.summary(); // { customer, offer, price }
  if (!(await confirm({ name: "Confirm contract", summary, page })))
    return { stoppedBefore: "Confirm contract" };
  const done = await review.confirm(); // irreversible
  return { contractNumber: await done.contractNumber() };
}
```

The entry script is what the user runs. It opens a headed browser, reads a
parameters file, records a trace for diagnosis, calls the flow with the
agreed `confirm` and prints the result. Start it the way the project runs
TypeScript, such as `npx tsx run-contract.ts .ayme/params/<file>.json`:

```ts
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

import { askInTerminal } from "./confirm.js";
import { runContract } from "./contract.js";

async function main() {
  const params = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: ".ayme/auth.json" });
  await context.tracing.start({ screenshots: true, snapshots: true });
  try {
    const page = await context.newPage();
    console.log(await runContract(page, params, { confirm: askInTerminal }));
  } finally {
    await context.tracing.stop({ path: `.ayme/runs/${Date.now()}/trace.zip` });
    await browser.close();
  }
}
void main();
```

On a site with a login, the user saves a login state once with
`npx playwright codegen --save-storage=.ayme/auth.json <url>`, logging in in
the window it opens; the entry script and the replay test load it. You never
handle the password. A login can expire within minutes: when the replay test
or a live run suddenly meets the login form, ask the user to save a fresh one
right before each such run. Without a login, drop `storageState`.

### Confirm

The skill builds in no policy for `confirm`. Two examples to adapt, or drop
for what the user's team needs. A terminal prompt, with the browser left open
on the filled form:

```ts
import { createInterface } from "node:readline/promises";

export const askInTerminal: Confirm = async ({ name, summary }) => {
  for (const [key, value] of Object.entries(summary))
    console.log(`  ${key}: ${value}`);
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await terminal.question(`Submit ${name}? [y/N] `);
  terminal.close();
  return answer.trim().toLowerCase() === "y";
};
```

An overlay in the page, with Submit and Cancel:

```ts
export const askInPage: Confirm = ({ name, summary, page }) =>
  page.evaluate(
    ({ name, summary }) =>
      new Promise<boolean>((resolve) => {
        const box = document.createElement("div");
        box.style.cssText =
          "position:fixed;top:16px;right:16px;z-index:2147483647;padding:12px;background:#fff;color:#000;border:2px solid #000;white-space:pre-line";
        box.textContent = [
          `Submit ${name}?`,
          ...Object.entries(summary).map(([key, value]) => `${key}: ${value}`),
          "",
        ].join("\n");
        for (const [label, answer] of [
          ["Submit", true],
          ["Cancel", false],
        ] as const) {
          const button = document.createElement("button");
          button.textContent = label;
          button.onclick = () => (box.remove(), resolve(answer));
          box.append(button);
        }
        document.body.append(box);
      }),
    { name, summary }
  );
```

## The replay test

Copy [`assets/replay.ts`](../assets/replay.ts) next to the replay test. Its
header says what loads live and what the recording answers. Write the
recorded parameter values, and the summary the recording's page showed before
each irreversible step, to `.ayme/params/<flow>.recorded.json`. The test
calls the same flow, never a copy of its steps, with a `confirm` that always
approves and keeps each summary, so the test checks what a person would:

```ts
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

import { runContract } from "../contract.js";
import { installReplay } from "./replay.js";

test.use({ serviceWorkers: "block", storageState: ".ayme/auth.json" });

test("contract flow replays", async ({ context }) => {
  await installReplay(context, ".ayme/recordings/rec_…/trace.zip");
  const page = await context.newPage();
  const { params, summaries } = JSON.parse(
    readFileSync(".ayme/params/contract.recorded.json", "utf8")
  );
  const seen: Record<string, Record<string, string>> = {};
  const result = await runContract(page, params, {
    confirm: async ({ name, summary }) => ((seen[name] = summary), true),
  });
  expect(result).not.toHaveProperty("stoppedBefore");
  expect(seen).toEqual(summaries);
});
```

Write `match()` in the copy for the site. Each `replay: aborted` line in the
output is a request it paired with no recorded call. Compare the request with
its recorded call from `trace request <n>`: when they differ only in a part
that changes between runs, such as a timestamp, counter, token or a build
stamp in the URL (`?r=1795017612`), leave that
part out of `match()`. When they differ in data, such as another record id,
the flow reads data the recording lacks: check the parameters. When the data
an earlier response filled in differs, such as an address from a postcode
lookup, that response landed at another time than in the recording: wait for
it in the page object; do not loosen `match()`. Telemetry calls are aborted
on every run; list them for the user once.
