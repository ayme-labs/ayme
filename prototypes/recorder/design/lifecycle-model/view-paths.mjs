// Plain-words labels for the bug paths of the full model.
const PHASE = {
  off: "Not recording",
  recording: "Recording",
  wrap: "Wrapping up",
  paused: "Paused",
  saving: "Saving",
  saved: "Ended: package saved",
  empty: "Ended: nothing to save",
  dead: "Killed",
};
const GOAL = { pause: "to pause", save: "to save", clear: "to clear", quit: "to clear and end" };

const thing = (v, i) => {
  const k = v.kind[i];
  if (k === "none") return null;
  const name = k === "type" ? `typing ${i}` : `click ${i}`;
  const where = {
    held: "held back, no 'before' yet",
    snapped: "held back, 'before' taken",
    page: v.wrong[i] ? "reached the NEW page" : "reached the page",
    picked: v.heldEver[i] ? "swallowed by Playwright's picker after being held" : "picked for an assertion",
    gone: "never delivered (page gone)",
  }[v.at[i]];
  const report = { none: "no report", flying: "report on its way", in: "report in", lost: "report lost" }[v.ev[i]];
  const entry = v.tl.includes(i)
    ? `in the timeline (before ${v.bef[i] || "-"}, after ${v.left[i] ? "none: left the page" : v.aft[i] || "-"})${v.dis.includes(i) ? ", discarded" : ""}`
    : "not in the timeline";
  return `${name}: ${where}; ${report}; ${entry}`;
};

export const state = (v) => {
  const parts = [];
  let p = PHASE[v.phase];
  if (v.phase === "wrap") p += ` ${GOAL[v.goal]}`;
  if (v.mode === "pick") p += ", Playwright is picking";
  parts.push(p);
  if (v.page === "closed") parts.push("page closed");
  else {
    parts.push(`gate ${v.gateOn ? "ON" : "off"} in the page${v.gateMsg !== "none" ? ` (switch-${v.gateMsg} on its way)` : ""}`);
    if (v.doc > 1) parts.push("on the new page");
    if (v.navFlying) parts.push("navigation under way");
  }
  if (v.pkg !== "none") parts.push(`package ${v.pkg}${v.saves > 1 ? `, saved ${v.saves} times` : ""}`);
  for (const i of Object.keys(v.kind)) {
    const t = thing(v, Number(i));
    if (t) parts.push(t);
  }
  if (v.tb !== "off" || v.win !== "off") parts.push(`toolbar shows ${v.tb}, window shows ${v.win}`);
  return parts.join(" | ");
};

const changed = (from, to, name) => {
  for (const i of Object.keys(to[name])) if (from[name][i] !== to[name][i]) return Number(i);
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
    case "YouDiscard":
      return "you discard an entry";
    case "YouRestore":
      return "you restore an entry";
    case "YouClick": {
      const i = changed(from, to, "at");
      const where = to.at[i];
      if (where === "picked") return `you click (click ${i}): Playwright's picker swallows it`;
      if (where === "held") return `you click (click ${i}): the gate holds it back`;
      return `you click (click ${i}): it reaches the page untouched${to.navFlying && !from.navFlying ? " and starts a navigation" : ""}`;
    }
    case "YouType": {
      const i = changed(from, to, "at");
      return `you type (typing ${i}): it reaches the page at once`;
    }
    case "TakeBefore":
      return `the recorder takes the 'before' of click ${changed(from, to, "at")}`;
    case "Resend": {
      const i = changed(from, to, "at");
      if (to.at[i] === "picked") return `the recorder passes click ${i} on: Playwright's picker swallows it`;
      return `the recorder passes click ${i} on to the page${to.wrong[i] ? " (the NEW page)" : ""}`;
    }
    case "TakeAfter":
      return `the page settles: the recorder takes the 'after' of ${changed(from, to, "aft")}`;
    case "ReportArrives": {
      const i = changed(from, to, "ev");
      return `Playwright's report for ${i} arrives: ${to.tl.includes(i) ? "added to the timeline" : "thrown away"}`;
    }
    case "GateMsgLands":
      return `the page switches the gate ${to.gateOn ? "on" : "off"}`;
    case "NavCommits":
      return "the new page loads";
    case "PageCloses":
      return "the last page closes";
    case "TerminalStop":
      return "you stop the recorder from the terminal";
    case "TerminalStopAgain":
      return "you stop it from the terminal a second time";
    case "WrapUpDone":
      return "the recorder finishes wrapping up";
    case "StartWriting":
      return "the recorder starts writing the package";
    case "SaveDone":
      return "the package is written";
    case "EngineTells":
      return "the recorder announces its new state";
    case "PushLands":
      return "the announcement reaches the toolbar";
    case "EngineReplies":
      return "the recorder answers the new page's question about the state";
    case "ReplyLands":
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
