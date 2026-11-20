// One click passing through the gate while recording.
export const title = "One click through the gate, while recording";

const list = (x) => (Array.isArray(x) ? x : Object.values(x ?? {}));

export const state = (v) => {
  const i = 1;
  const written = list(v.tl).includes(i);
  if (v.page === "closed")
    return v.at[i] === "gone"
      ? "The page is gone, the click is dropped"
      : "The page is gone, the entry keeps its 'before' only";
  if (v.at[i] === "notyet") return "Waiting for your click";
  if (v.at[i] === "held")
    return v.stage[i] === "passingOn"
      ? "'Before' taken, click still held"
      : "Click held back, 'before' being taken";
  const where = v.doc > 1 ? " (on the new page)" : "";
  if (written)
    return v.doc > 1
      ? "Written: a 'before', and an 'after' on the new page"
      : "Written: the entry has a 'before' and an 'after'";
  switch (v.stage[i]) {
    case "settling":
      return `Click passed on, page still changing${where}`;
    case "takingAfter":
      return `Page settled, 'after' being taken${where}`;
    case "settled":
      return `'After' taken${where}, waiting for Playwright's report`;
    default:
      return v.stage[i];
  }
};

export const step = (action, from, to) => {
  switch (action) {
    case "ClickHeld":
      return "you click";
    case "SnapshotTaken":
      return from.at[1] === "held"
        ? "the recorder takes the 'before' snapshot"
        : "the recorder takes the 'after' snapshot";
    case "PassOn":
      return "the recorder sends your click on to the page";
    case "PageSettles":
      return "the page has settled (quiet, or the deadline passed)";
    case "ReportArrives":
      return "Playwright's report arrives";
    case "NavCommits":
      // Once the entry is written, the new page changes nothing of it.
      return list(from.tl).includes(1)
        ? null
        : "the click leaves the page and a new page loads";
    case "PageClosesWhileHeld":
      return "the page closes";
    default:
      return null;
  }
};
