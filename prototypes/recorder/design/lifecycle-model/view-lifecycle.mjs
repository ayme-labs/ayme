// The recording's lifecycle through the commands, in the person's words.
export const title = "The recording, from Record to the saved package (proposed design)";

export const state = (v) => {
  switch (v.phase) {
    case "off":
      return "Not recording, nothing recorded";
    case "recording":
      return v.mode === "pick" ? ["Recording", "Waiting for you to pick an element"] : ["Recording", "Listening"];
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
      return "Ended with a complete package";
    case "empty":
      return "Ended with 'empty', nothing to save";
    default:
      return v.phase;
  }
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
    case "YouPressClear":
      return "you press Clear";
    case "YouPressAssert":
      return "you press Assert visibility";
    case "PickClick":
      return "you click the element (recorded as an assertion)";
    case "PageCloses":
    case "TerminalStop":
      return "you close the last page, or stop the recorder from the terminal";
    case "WrapUpDone":
      return "the gate is confirmed off, held clicks are passed on, Playwright's reports are in";
    case "SaveDone":
      return "the package is written";
    default:
      return null;
  }
};

export const group = (v) =>
  v.phase === "recording"
    ? "Recording"
    : v.phase === "wrap" || v.phase === "saving"
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
