// Plain-words labels for the bug paths of the full model.
const PHASE = {
  off: "Not recording",
  recording: "Recording",
  wrap: "Wrapping up",
  paused: "Paused",
  saving: "Saving",
  saved: "Ended: package saved",
  empty: "Ended: 'empty'",
};
const GOAL = {
  pause: "to pause",
  save: "to save",
  clear: "to clear",
  quit: "to clear and end",
};
const BOOT = {
  trace: "the trace is starting",
  report: "Playwright is being switched on",
  gate: "the page's gate is being switched on",
};
const STAGE = {
  waiting: "waits its turn",
  takingBefore: "its 'before' is being taken",
  passingOn: "on its way to the page",
  settling: "the page is settling",
  takingAfter: "its 'after' is being taken",
  settled: "complete, not written yet",
};

const list = (x) => (Array.isArray(x) ? x : Object.values(x ?? {}));
const inList = (v, e) => list(v.lst).includes(e);

const thing = (v, i, n) => {
  const k = v.kind[i];
  if (k === "none") return null;
  const name = k === "type" ? `typing ${i}` : `click ${i}`;
  const where = {
    held: "held back by the gate",
    page: "reached the page",
    picked: "taken by Playwright's picker",
    gone: "never delivered (its document is gone)",
  }[v.at[i]];
  const report = {
    none: "no report",
    flying: "report on its way",
    in: "report in",
    lost: "report lost",
  }[v.ev[i]];
  const entries = [i, i + n]
    .filter((e) => v.ent[e] !== "none")
    .map((e) => {
      const what = {
        click: "held",
        key: "held key",
        rep: "known from its report",
        assert: "assertion",
      }[v.ent[e]];
      if (list(v.tl).includes(e))
        return `${what} entry written (before ${v.bsnap[e]}, after ${v.asnap[e] || "none"})`;
      if (inList(v, e))
        return `${what} entry: ${STAGE[v.stage[e]] ?? v.stage[e]}`;
      if (v.stage[e] === "keyDone") return "held key passed on";
      return `${what} entry ${v.stage[e] === "out" ? "dropped" : "left behind"}`;
    });
  const more =
    v.keys[i] > 0
      ? `, ${v.keys[i]} more key${v.revFly[i] ? " (revision on its way)" : ""}`
      : "";
  // The change: what the window shows of a fill.
  const window = v.fin?.[i]
    ? ""
    : v.shown?.[i]
      ? `; in the window: text of ${v.txt[i]} key${v.txt[i] > 1 ? "s" : ""}, ${v.asnap[i] === 0 ? "no changes yet" : `changes up to read ${v.asnap[i]}`}`
      : "";
  return `${name}: ${where}${more}; ${report}${entries.length ? "; " + entries.join(", ") : ""}${window}`;
};

export const state = (v) => {
  const n = Object.keys(v.kind).length;
  const parts = [];
  let p = PHASE[v.phase];
  if (v.phase === "wrap") p += ` ${GOAL[v.goal]}`;
  if (v.phase === "recording" && v.boot !== "none")
    p += ` (${BOOT[v.boot]}; shows ${v.resumed ? "Paused" : "Not recording"})`;
  if (v.phase === "recording" && v.picking !== "off")
    p += v.picking === "on" ? ", picking" : ", Assert visibility pressed";
  parts.push(p);
  if (v.page === "closed") parts.push("page closed");
  else {
    const gate = v.pickPg
      ? "gate leaves clicks to picking"
      : `gate ${v.gateOn ? "ON" : "off"}${v.holdPg ? ", holds what follows" : ""}`;
    parts.push(gate);
    if (v.doc > 1) parts.push("on the new page");
    if (v.navFlying) parts.push("navigation under way");
  }
  parts.push(
    `Playwright ${{ none: "off", rec: "reporting", pick: "picking" }[v.mode]}`
  );
  if (v.pkg !== "none")
    parts.push(
      v.pkg === "complete"
        ? `package written (${list(v.pkgHas).length} entries)`
        : "nothing to save"
    );
  for (let i = 1; i <= n; i += 1) {
    const t = thing(v, i, n);
    if (t) parts.push(t);
  }
  if (v.tb !== "off" || v.win !== "off")
    parts.push(`toolbar shows ${v.tb}, window shows ${v.win}`);
  return parts.join(" | ");
};

const changed = (from, to, name) => {
  for (const i of Object.keys(to[name]))
    if (JSON.stringify(from[name][i]) !== JSON.stringify(to[name][i]))
      return Number(i);
  return 0;
};

export const step = (action, from, to) => {
  switch (action) {
    case "YouPressRecord":
      return "you press Record";
    case "YouPressStop":
      return "you press Stop";
    case "YouPressContinue":
      return "you press Continue";
    case "YouPressFinish":
      return "you press Finish";
    case "YouPressFinishAgain":
      return "you press Finish again (ignored)";
    case "YouPressClear":
      return "you press Clear";
    case "YouPressAssert":
      return "you press Assert visibility";
    case "YouLeaveAssert":
      return "you press Assert visibility again, to leave it";
    case "YouDiscard":
      return "you discard an entry";
    case "YouRestore":
      return "you restore an entry";
    case "ClickPicked":
      return `you click (click ${changed(from, to, "at")}): Playwright's picker takes it`;
    case "ClickHeld":
      return `you click (click ${changed(from, to, "at")}): the gate holds it back`;
    case "ClickReaches": {
      const i = changed(from, to, "at");
      if (to.at[i] === "picked")
        return `you click (click ${i}): Playwright's picker takes it`;
      return `you click (click ${i}): it reaches the page untouched${to.navFlying && !from.navFlying ? " and starts a navigation" : ""}`;
    }
    case "TypeHeld":
      return `you type (typing ${changed(from, to, "at")}): the gate holds the key back`;
    case "TypeReaches":
      return `you type (typing ${changed(from, to, "at")}): it reaches the page at once`;
    case "TypeMore":
      return `you type one more key into the same field (typing ${changed(from, to, "keys")})`;
    case "PassGone":
      return `the recorder passes ${changed(from, to, "at")} on: its document is gone, it is dropped`;
    case "PassOn": {
      const i = changed(from, to, "at");
      if (to.at[i] === "picked")
        return `the recorder passes ${i} on: Playwright's picker takes it`;
      return `the recorder passes ${i} on to the page`;
    }
    case "SnapshotTaken":
      return "the recorder reads the page (a snapshot)";
    case "PageSettles":
      return "the page has settled";
    case "ReportArrives": {
      const i = changed(from, to, "ev");
      return `Playwright's report of ${i} reaches the recorder`;
    }
    case "RevisionArrives":
      return `Playwright's revised report of typing ${changed(from, to, "revFly")} reaches the recorder`;
    case "GateSwitchLands":
      return `the page switches its gate ${to.gateOn ? "on" : "off"}`;
    case "ModeLands":
      return to.mode === "pick" && from.mode !== "pick"
        ? "Playwright starts picking"
        : from.mode === "pick" && to.mode !== "pick"
          ? "Playwright stops picking"
          : `Playwright's recorder is switched ${to.mode === "none" ? "off" : "on"}`;
    case "TraceLands":
      return {
        on: "the trace starts",
        kept: "the trace is stopped and kept",
        off: "the trace is thrown away",
      }[to.tracing];
    case "SavedArrives":
      return "the recorder ends";
    case "TimeLimitPasses":
      return "five seconds pass: the wrap-up gives up waiting";
    case "NavCommits":
      return "the new page loads";
    case "PageCloses":
      return "you close the page";
    case "TerminalStop":
      return "you stop the recorder from the terminal";
    case "BridgeAnswers":
      return "the toolbar is answered with the state";
    case "AnswerLands":
      return "that answer reaches the toolbar";
    case "WindowCatchesUp":
      return "the window catches up";
    case "YouReloadWindow":
      return "you reload the window";
    case "Ended":
      return "nothing more happens";
    default:
      return action;
  }
};
