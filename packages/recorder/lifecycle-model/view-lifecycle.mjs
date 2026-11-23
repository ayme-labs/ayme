// The recording's lifecycle through the commands, as the window shows it.
export const title = "The recording, from Record to the saved package";

export const state = (v) => {
  switch (v.phase) {
    case "off":
      return "Not recording";
    case "recording":
      if (v.boot !== "none")
        return v.resumed
          ? "Still shows Paused: Continue waits for Playwright and the page"
          : "Still shows Not recording: Record waits for the trace, Playwright and the page";
      if (v.picking === "on") return ["Recording", "Picking an element"];
      if (v.picking !== "off")
        return [
          "Recording",
          "Assert visibility pressed, Playwright not picking yet",
        ];
      return ["Recording", "Listening"];
    case "wrap":
      return {
        pause: "Wrapping up, then pause",
        save: "Wrapping up, then save",
        clear: "Wrapping up, then clear",
        quit: "Wrapping up, then clear and end",
      }[v.goal];
    case "paused":
      return "Paused (you can discard and restore entries)";
    case "saving":
      return "Saving the package";
    case "saved":
    case "empty":
      return v.storage === "asked"
        ? "Saving the storage state (--save-storage)"
        : "Ended: the package, or 'empty' when no step was recorded";
    default:
      return v.phase;
  }
};

export const step = (action, from, to) => {
  // What the engine does on its own is named by what it leads to.
  if (
    from.phase === "wrap" &&
    to.phase !== "wrap" &&
    !["PageCloses", "TerminalStop"].includes(action)
  )
    return to.phase === "saving" || to.phase === "paused"
      ? "the wrap-up is done"
      : "the old trace is thrown away";
  if (
    from.phase === "recording" &&
    from.boot !== "none" &&
    to.phase === "recording" &&
    to.boot === "none"
  )
    return "Playwright reports and the page holds inputs back: Record or Continue is answered";
  if (from.phase === "saving" && to.phase !== "saving")
    return "the package is written, or there was nothing to write";
  if (action === "StorageLands")
    return "the storage state is saved, or a warning says it could not be";
  switch (action) {
    case "YouPressRecord":
      return "you press Record";
    case "YouPressStop":
      return "you press Stop";
    case "YouPressContinue":
      return "you press Continue";
    case "YouPressFinish":
      return "you press Finish";
    case "YouPressClear":
      return "you press Clear";
    case "YouPressAssert":
      return "you press Assert visibility";
    case "YouLeaveAssert":
      return "you press Assert visibility again";
    case "ClickPicked":
      return "you click the element (recorded as an assertion)";
    case "PageCloses":
    case "TerminalStop":
      return "you close the last page, or stop the recorder from the terminal";
    default:
      return null;
  }
};

export const group = (v) =>
  v.phase === "recording" && v.boot === "none"
    ? "Recording"
    : v.phase === "wrap" ||
        v.phase === "saving" ||
        v.phase === "recording" ||
        v.storage === "asked"
      ? "Busy, the buttons wait"
      : v.phase === "paused"
        ? "Paused"
        : v.phase === "off"
          ? "Not started"
          : "Ended";
export const colors = {
  Recording: "teal",
  "Busy, the buttons wait": "yellow",
  Paused: "blue",
  "Not started": "tan",
  Ended: "purple",
};
