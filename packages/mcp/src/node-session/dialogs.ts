// Spike (dialogs): what the background process does when a JavaScript dialog
// opens in its tab. Ayme never answers a dialog; the developer's automation
// does. A call whose action opened a dialog nobody answers returns at once,
// and so does every later command that needs the page while it is open. When
// the dialog is answered, the action is stopped at its next Playwright call
// (dismissed, or either answer with AYME_SPIKE_STOP=both) or let go (accepted).
//
// Variants, from the environment, so one build tries them all:
// - AYME_SPIKE_STOP: "dismissed" (default) or "both".
// - AYME_SPIKE_OWN: how Ayme tells an action that answers its own dialog:
//   "listeners" (default: the page has a dialog listener when it opens) or
//   "grace:<ms>" (the dialog is still open after that long).
// - AYME_SPIKE_HOLD: "1" (default) holds the action's calls from the moment
//   an unanswered dialog is reported until its answer is known; "0" does not.
// - AYME_SPIKE_LOG: a file each event is appended to as a JSON line.
import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import type { Dialog, Page } from "@playwright/test";

import type { AymePlaywright } from "./attach";

type Gate = AymePlaywright["spikeRunGate"];

const stopMode = process.env.AYME_SPIKE_STOP === "both" ? "both" : "dismissed";
const ownMode = process.env.AYME_SPIKE_OWN ?? "listeners";
const graceMs = ownMode.startsWith("grace:")
  ? Number(ownMode.slice("grace:".length))
  : undefined;
const holds = process.env.AYME_SPIKE_HOLD !== "0";

/** Wall-clock milliseconds, with the fraction, so other processes' times compare. */
/** Playwright's Page and BrowserContext are EventEmitters, which their types do not say. */
const listeners = (emitter: object) =>
  (emitter as { listenerCount(event: string): number }).listenerCount("dialog");

const now = () => performance.timeOrigin + performance.now();

export function spikeLog(event: string, data: Record<string, unknown> = {}) {
  const line = JSON.stringify({ t: Number(now().toFixed(1)), event, ...data });
  if (process.env.AYME_SPIKE_LOG)
    appendFileSync(process.env.AYME_SPIKE_LOG, `${line}\n`);
  else console.log(line);
}

type OpenDialog = {
  type: string;
  message: string;
  defaultValue: string;
  openedAt: number;
  /** Whether a call was told about it: nobody was expected to answer it. */
  reported: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

type RunEntry = {
  id: number;
  name: string;
  startedAt: number;
  ended: boolean;
  /** Its call returned with the dialog text; its own outcome is dropped. */
  discarded: boolean;
  answer?: "accepted" | "dismissed";
  answeredAt?: number;
  onDialog: (text: string) => void;
};

/** The text a command prints while `dialog` is open. */
function dialogText(dialog: OpenDialog): string {
  const value =
    dialog.type === "prompt"
      ? ` Its default value is "${dialog.defaultValue}".`
      : "";
  return `A ${dialog.type} dialog is open on the page: "${dialog.message}".${value} Answer it with your browser automation, then run ayme again.`;
}

/**
 * Watches dialogs in `page`'s tab, through Playwright's events and a CDP
 * session of its own. `wrap` runs a call's Run and resolves with its outcome,
 * or with the dialog text when the Run opened a dialog nobody answers.
 */
export async function watchDialogs(page: Page, gate: Gate) {
  const runs: RunEntry[] = [];
  let open: OpenDialog | undefined;
  let nextId = 1;
  const current = () => runs.find((run) => !run.ended);

  const report = (dialog: OpenDialog) => {
    dialog.reported = true;
    const run = current();
    spikeLog("dialog-reported", {
      run: run?.id,
      afterOpenMs: Number((now() - dialog.openedAt).toFixed(1)),
    });
    if (!run) return;
    if (holds) gate.hold();
    run.discarded = true;
    run.onDialog(dialogText(dialog));
  };

  page.context().on("dialog", (dialog: Dialog) => {
    if (dialog.page() !== page) return;
    // Context listeners hear the dialog before the page's, so a page
    // listener an action added with `once` is still counted.
    const pageListeners = listeners(page);
    open = {
      type: dialog.type(),
      message: dialog.message(),
      defaultValue: dialog.defaultValue(),
      openedAt: now(),
      reported: false,
    };
    spikeLog("pw-dialog", {
      type: open.type,
      message: open.message,
      pageListeners,
      contextListeners: listeners(page.context()),
      run: current()?.id,
      ownMode,
    });
    if (graceMs !== undefined) {
      const dialogNow = open;
      dialogNow.timer = setTimeout(() => {
        if (open === dialogNow) report(dialogNow);
      }, graceMs);
    } else if (pageListeners === 0) report(open);
    else spikeLog("own-answer-expected", { run: current()?.id });
  });
  page.on("dialogclosed" as never, () => spikeLog("pw-dialogclosed"));

  const cdp = await page.context().newCDPSession(page);
  cdp.on("Page.javascriptDialogOpening", (event) =>
    spikeLog("cdp-opening", { type: event.type, message: event.message })
  );
  cdp.on("Page.javascriptDialogClosed", (event) => {
    const answer = event.result ? "accepted" : "dismissed";
    const dialog = open;
    open = undefined;
    if (dialog?.timer) clearTimeout(dialog.timer);
    const run = current();
    spikeLog("cdp-closed", {
      result: event.result,
      userInput: event.userInput,
      answer,
      afterOpenMs: dialog && Number((now() - dialog.openedAt).toFixed(1)),
      reported: dialog?.reported,
      run: run?.id,
    });
    if (!dialog?.reported || !run) return;
    run.answer = answer;
    run.answeredAt = now();
    if (answer === "dismissed" || stopMode === "both")
      gate.refuse(
        `the ${dialog.type} dialog it opened was ${answer} by another tool, so Ayme stopped the action.`
      );
    else gate.allow();
    spikeLog("gate", { state: gate.state, run: run.id });
  });
  // The calls a Page Object Action's own code makes: its async chain.
  const inAction = new AsyncLocalStorage<true>();
  gate.scope = {
    run: (execute) => inAction.run(true, execute),
    active: () => inAction.getStore() === true,
  };
  gate.onCall = (call, phase) =>
    spikeLog("call", { run: current()?.id, call, phase, gate: gate.state });
  gate.onPhase = (part, edge) =>
    spikeLog("phase", { run: current()?.id, part, edge });
  gate.onMethodEnd = (outcome) => {
    const run = current();
    spikeLog("method-end", {
      run: run?.id,
      outcome: outcome.slice(0, 160),
      answeredToMethodEndMs:
        run?.answeredAt && Number((now() - run.answeredAt).toFixed(1)),
    });
  };
  gate.onActionEnd = () => {
    const run = current();
    spikeLog("action-end", {
      run: run?.id,
      answeredToActionEndMs:
        run?.answeredAt && Number((now() - run.answeredAt).toFixed(1)),
    });
  };
  await cdp.send("Page.enable");
  spikeLog("watching", { stopMode, ownMode, holds });

  return {
    /**
     * Spike (hidden tab): ends the Run in progress as a dialog does: its
     * command answers `text` at once and the action's further calls throw
     * `refusal`. Whether a Run was in progress.
     */
    endCurrent(text: string, refusal: string): boolean {
      const run = current();
      if (!run || run.discarded) return false;
      run.discarded = true;
      gate.refuse(refusal);
      spikeLog("hidden-ended", { run: run.id, gate: gate.state });
      run.onDialog(text);
      return true;
    },
    /** The dialog text while a dialog is open in the tab. */
    openText: () => (open ? dialogText(open) : undefined),
    /** Runs `execute` as the call `name`, answered early when it opens a dialog nobody answers. */
    wrap<T>(
      name: string,
      execute: () => Promise<T>,
      dialogAnswer: (text: string) => T
    ): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const run: RunEntry = {
          id: nextId++,
          name,
          startedAt: now(),
          ended: false,
          discarded: false,
          onDialog: (text) => resolve(dialogAnswer(text)),
        };
        const finish = (outcome?: T, error?: unknown) => {
          run.ended = true;
          runs.splice(runs.indexOf(run), 1);
          const end = now();
          spikeLog("run-end", {
            run: run.id,
            name: run.name,
            discarded: run.discarded,
            answer: run.answer,
            answeredToEndMs:
              run.answeredAt && Number((end - run.answeredAt).toFixed(1)),
            totalMs: Number((end - run.startedAt).toFixed(1)),
            outcome: error === undefined ? outcome : undefined,
            error: error === undefined ? undefined : String(error),
          });
          if (run.discarded) return;
          if (error === undefined) resolve(outcome as T);
          else reject(error as Error);
        };
        runs.push(run);
        spikeLog("run-start", { run: run.id, name });
        execute().then(
          (outcome) => finish(outcome),
          (error: unknown) => finish(undefined, error)
        );
      });
    },
  };
}
