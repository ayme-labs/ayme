# Playbook: production automation

The result is a deterministic, parameterised Playwright automation of a flow
the user does on a website, and a replay test that lets you fix its waits and
locators without touching the real backend. Some steps are irreversible: a
final "Confirm" can create a real contract. Only the user approves one.

## Steps

1. **Analyze** the package and its trace, as
   [Read the package](../SKILL.md#read-the-package) and
   [Use the trace](../SKILL.md#use-the-trace) say. List the calls with
   `trace requests` and read each one in full with `trace request <n>`.
   Classify each call as a read or a permanent change from the evidence: the
   method, the URL or action name, the request body, the response, and what
   changed on the page right after it. The method alone does not decide it:
   reads can be POSTs, and GETs can change state. The package can end before
   the page shows a step's result: read that result, and whether each
   permanent change succeeded, from the responses. Done when every call the
   flow makes is classified.
2. **Align** with the user before you write code. Take what
   `.ayme/CONVENTIONS.md` already settles, and settle the rest:
   - the steps of the flow;
   - the page objects;
   - the irreversible steps: propose those the permanent changes from step 1
     point to, and take the list the user confirms; there can be several;
   - for each, the values a person checks before it, such as customer, offer
     and price;
   - the parameters: the data a real run enters, and the value the recording
     used for each;
   - the `confirm` the entry script uses, as [Confirm](#confirm) says;
   - on a site with a login, where a run gets its credentials: a saved login
     state, environment variables or the team's secret store. They never go
     into code, a parameter file or `.ayme/CONVENTIONS.md`. Tell the user
     that the recording holds any password it captured;
   - where the parameter files, run traces and login state go: they hold
     real data.

   Done when the user has confirmed each, and you have written what they
   settled for every flow in the repository to `.ayme/CONVENTIONS.md`,
   creating it when it is missing: never real data. What holds for one site
   or one flow goes next to its code: in the code where code can say it,
   otherwise in a notes file beside it. The conventions file says where such
   notes live.

3. **Write** the code, as [Write the code](#write-the-code) says.
4. **Write the replay test**, as [The replay test](#the-replay-test) says.
5. **Heal** against the replay test. Run it with
   `npx playwright test <file> --repeat-each 3 --retries 0 --workers 1` and
   fix the page objects' locators and waits, never the flow's steps. When
   passing would take other steps, stop and tell the user. Keep every wait
   for an action's own outcome, as
   [Page object design](../references/page-object-design.md#wait-only-for-the-actions-own-outcome)
   asks, even when the test passes without it. Prove each other wait: take it
   out and run three times at recorded speed, then three times with answers
   near-instant: `REPLAY_SPEED=1000` has `replay.ts` answer a thousand times
   faster than recorded. Put the wait back if either set of runs fails or
   flakes without it, and remove it if both pass. Then run it once
   with `--trace on`, open that run's trace with
   `npx playwright trace open <trace.zip>`, and list its calls with
   `npx playwright trace requests`: every request other than GET or HEAD
   must show `fulfilled` or `aborted` in the route column. One that shows
   `continued`, or nothing, reached the live site: stop and tell the user.
   Done when the test passes three runs in a row with every wait proven and
   the trace shows no such request.
6. **Rehearse live** with fresh real data the user gives you for one run,
   written where step 2 settled. Run the entry script headed, with the user
   watching. The user answers each confirm, or with the
   highlight clicks the outlined control: that lets the same run make the
   real submission, and anything else stops it. With the terminal prompt, the
   user starts the command in their own terminal, since its prompt reads from
   the terminal that started it. You never approve an irreversible step: a
   live run the user does not watch uses `--no-submit`.
   When a run fails, read its trace with the project's own
   Playwright: `npx playwright trace open <trace.zip>`, then `trace actions`
   and `trace snapshot`. Fix the code, run the replay test again until it
   passes three times, and rehearse with new data.
7. **Hand over**: the command for a real run, where the files are, and what
   the replay test does not cover, such as steps the recording does not
   reach or calls it aborted on every run. Write down what you learned
   about the site that the next flow would have to find again, where step 2
   says.

Done when a live rehearsal has run without failing and the user has the
hand-over.

## Write the code

A reference layout, for a flow named `contract`. Follow the project's own
layout where it has one:

```text
pages/                             page objects
contract.ts                        runContract(page, params, { confirm })
confirm.ts                         the agreed confirm
run-contract.ts                    the entry script
tests/contract.replay.spec.ts      the replay test
tests/replay.ts                    copy of assets/replay.ts, with match() for the site
.ayme/
  CONVENTIONS.md                   what holds for every flow in the repository
  recordings/rec_…/                the recording, written by the recorder
  params/contract.recorded.json    what the recording entered and showed
  params/contract.<date>.json      the data of one live run
  auth.json                        the saved login
  runs/<time>/trace.zip            the trace of each live run
```

Write plain Playwright page objects by
[Page object design](../references/page-object-design.md) and
[Write page objects from the recording](../SKILL.md#write-page-objects-from-the-recording),
with no Ayme decorators. Each irreversible step is its own page object
action, and the wait for its result can also be called on its own.

The flow is one function, `run<Flow>(page, params, { confirm })`. Before each
irreversible step it reads the agreed values back from the page through the
page objects and asks `confirm`, which answers one of three ways. `"stop"`:
the flow stops before the step and returns where it stopped. `"submit"`: the
flow does the step. `"submitted"`: the user did the step in the page, so the
flow only waits for its result:

```ts
export type Confirm = (step: {
  name: string;
  summary: Record<string, string>;
  page: Page;
  target: Locator; // the control that makes the step final
}) => Promise<"submit" | "submitted" | "stop">;

export async function runContract(
  page: Page,
  params: ContractParams,
  { confirm }: { confirm: Confirm }
) {
  const form = await new ContractPage(page).open();
  const review = await form.fill(params);
  const summary = await review.summary(); // { customer, offer, price }
  const answer = await confirm({
    name: "Confirm contract",
    summary,
    page,
    target: review.confirmButton,
  });
  if (answer === "stop") return { stoppedBefore: "Confirm contract" };
  const done =
    answer === "submit"
      ? await review.confirm() // irreversible: clicks, then waits
      : await review.confirmed();
  return { contractNumber: await done.contractNumber() };
}
```

The entry script is what the user runs. It opens a headed browser, reads a
parameters file, records a trace for diagnosis, calls the flow with the
agreed `confirm` and prints the result. Start it the way the project runs
TypeScript, such as `npx tsx run-contract.ts .ayme/params/<file>.json`. With
`--no-submit` it prints the summary and stops before the first irreversible
step: use it for any live run the user does not watch.

```ts
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

import { askInTerminal } from "./confirm.js";
import { type Confirm, runContract } from "./contract.js";

async function main() {
  const params = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
  const confirm: Confirm = process.argv.includes("--no-submit")
    ? async ({ name, summary }) => (console.log(name, summary), "stop")
    : askInTerminal;
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: ".ayme/auth.json" });
  await context.tracing.start({ screenshots: true, snapshots: true });
  try {
    const page = await context.newPage();
    console.log(await runContract(page, params, { confirm }));
  } finally {
    await context.tracing.stop({ path: `.ayme/runs/${Date.now()}/trace.zip` });
    await browser.close();
  }
}
void main();
```

On a site with a login, one way to get one: the user saves a login state
with `npx playwright codegen --save-storage=.ayme/auth.json <url>`, logging
in in the window it opens; the entry script and the replay test load it.

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
  return answer.trim().toLowerCase() === "y" ? "submit" : "stop";
};
```

A highlight in the page: it outlines the control and waits, and the user's
own click on it is the approval, so the automation never clicks it. Without a
click before the timeout, the flow stops. After a click the flow waits for
the result, so a result that does not show is an error, never a stop:

```ts
export const highlightAndWait =
  (timeout = 10 * 60_000): Confirm =>
  async ({ name, summary, page, target }) => {
    console.log(`Click the outlined control to submit ${name}:`, summary);
    await target.highlight();
    let timer: NodeJS.Timeout | undefined;
    const clicked = await Promise.race([
      target.evaluate(
        (control) =>
          new Promise<true>((resolve) =>
            control.addEventListener("click", () => resolve(true), {
              once: true,
            })
          )
      ),
      new Promise<false>((resolve) => {
        timer = setTimeout(resolve, timeout, false);
      }),
    ]);
    clearTimeout(timer);
    await page.hideHighlight();
    return clicked ? "submitted" : "stop";
  };
```

## The replay test

Copy [`assets/replay.ts`](../assets/replay.ts) next to the replay test. Its
header says what loads live and what the recording answers. Write the
recorded parameter values, and the summary the recording's page showed before
each irreversible step, read from the snapshot of the interaction before
it, to `.ayme/params/<flow>.recorded.json` as `{ params, summaries }`, with
a placeholder in place of any password the recording captured. The test
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
    confirm: async ({ name, summary }) => ((seen[name] = summary), "submit"),
  });
  expect(result).not.toHaveProperty("stoppedBefore");
  expect(seen).toEqual(summaries);
});
```

Write `match()` in the copy for the site. Each `replay: aborted` line in the
output is a request it paired with no recorded call, followed by the closest
recorded call with the same method and path and the fields where the two
differ; read a recorded call in full with `trace request <n>`. When they
differ only in a part that changes between runs, such as a timestamp, counter
or token, or in a password the recorded file replaced, leave that part out
of `match()`. When they differ in data, such as
another record id, the flow reads data the recording lacks: check the
parameters. When they differ in data an earlier response filled in, that
response landed at another moment than in the recording: wait for it in the
page object; do not loosen `match()`. Telemetry calls are aborted on every
run; list them for the user once.
