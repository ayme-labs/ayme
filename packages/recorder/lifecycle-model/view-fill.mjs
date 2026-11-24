// One fill's life in the window, from its first key to final: its text
// follows every key, the changes under it follow the reads of the page.
export const title = "A fill in the window, from its first key to final";

const i = 1;

export const state = (v) => {
  if (v.kind[i] === "none") return "Not typed yet";
  if (v.at[i] === "held") return "First key held back while the page is read";
  if (v.fin[i])
    return v.phase === "recording"
      ? "Final: your next action ended it"
      : "Final: Stop ended it";
  if (v.shown[i]) {
    if (v.asnap[i] === 0) return "Shown: its text, no changes yet";
    if (v.keys[i] > 0 && v.txt[i] > 1 && v.asnap[i] <= v.revAt[i])
      return "Shown: its text is ahead of its changes";
    return "Shown: its text and its changes";
  }
  if (v.ent[i] === "rep") return "Reported: waits for its place in the list";
  return "Typed, Playwright's report on its way";
};

export const step = (action, from, to) => {
  switch (action) {
    case "FTypeHeld":
      return "you type the first key: the page holds it";
    case "FTypeReaches":
      return "you type the first key";
    case "FTypeMore":
      return "you type another key";
    case "FClick":
      return "you click (your next action)";
    case "FStop":
      return "you press Stop";
    case "FPassOn":
      return to.at[i] !== from.at[i]
        ? "the page reads, then gets the key"
        : null;
    case "FReport":
      if (to.ev[i] !== from.ev[i])
        return !from.shown[i] && to.shown[i]
          ? "Playwright reports the typing: the fill shows"
          : "Playwright reports the typing";
      return null;
    case "FRevision":
      return "Playwright revises the report: the text updates at once";
    case "FSnapshot":
    case "FSettles":
      if (!from.shown[i] && to.shown[i])
        return "the page is read: the fill shows";
      if (!from.fin[i] && to.fin[i])
        return "the page is read: the fill is final";
      return to.shown[i] && from.asnap[i] !== to.asnap[i]
        ? "the page is read: its changes update"
        : null;
    case "FMode":
    case "FGate":
      return !from.fin[i] && to.fin[i]
        ? "Playwright is off: the fill is final"
        : null;
    default:
      return null;
  }
};
