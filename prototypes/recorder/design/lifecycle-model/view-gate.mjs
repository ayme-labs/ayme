// One click passing through the gate while recording.
export const title = "One click through the gate, while recording";

export const state = (v) => {
  const i = 1;
  const inTimeline = v.tl.includes(i);
  if (v.page === "closed") return "The page is gone, the click is dropped";
  switch (v.at[i]) {
    case "notyet":
      return "Waiting for your click";
    case "held":
      return "Click held back";
    case "snapped":
      return "'Before' taken, click still held";
    case "page":
      if (v.left[i])
        return inTimeline ? "Done, the entry has a 'before' only (the click left the page)" : "On the new page, waiting for Playwright's report";
      if (v.aft[i] === 0)
        return inTimeline ? "Page still changing, entry already in the timeline" : "Click passed on, page still changing";
      return inTimeline ? "Done, the entry has a 'before' and an 'after'" : "'After' taken, waiting for Playwright's report";
    default:
      return v.at[i];
  }
};

export const step = (action, from, to) => {
  switch (action) {
    case "YouClick":
      return "you click";
    case "TakeBefore":
      return "the recorder takes the 'before' snapshot";
    case "Resend":
      return "the recorder sends your click on to the page";
    case "TakeAfter":
      return "the page finishes changing (quiet for 150 ms, or 2 s pass) and the recorder takes the 'after' snapshot";
    case "ReportArrives":
      return "Playwright's report arrives";
    case "NavCommits":
      return "the click leaves the page and a new page loads";
    case "PageClosesWhileHeld":
      return "the page closes";
    default:
      return null;
  }
};
