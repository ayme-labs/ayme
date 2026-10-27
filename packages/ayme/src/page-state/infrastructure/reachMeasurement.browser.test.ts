import { afterEach, describe, expect, it, vi } from "vitest";

import { createPage } from "../../page-objects/infrastructure";
import { inReachBatch, measureReach } from "./reachMeasurement";

const ROWS = 200;

describe("A batch reach pass, in Chromium", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  function renderRows() {
    document.body.innerHTML = `<ul>${Array.from(
      { length: ROWS },
      (_, index) => `<li><button type="button">Row ${index}</button></li>`
    ).join(
      ""
    )}</ul><dialog id="dialog"><button type="button">Close</button></dialog>`;
    return [...document.querySelectorAll("li button")];
  }

  function countModalQueries() {
    const querySelectorAll = vi.spyOn(Document.prototype, "querySelectorAll");
    return () =>
      querySelectorAll.mock.calls.filter(
        ([selectors]) => selectors === ":modal"
      ).length;
  }

  it("asks the document for its open modals once, for every element it measures", () => {
    const rows = renderRows();
    const page = createPage();
    const modalQueries = countModalQueries();

    inReachBatch(() => rows.map((row) => measureReach(page, row)));

    expect(modalQueries()).toBe(1);
  });

  it("sees a modal opened after an earlier pass", () => {
    const rows = renderRows();
    const page = createPage();
    const dialog = document.getElementById("dialog") as HTMLDialogElement;

    const before = inReachBatch(() =>
      rows.map((row) => measureReach(page, row))
    );
    dialog.showModal();
    const after = inReachBatch(() =>
      rows.map((row) => measureReach(page, row))
    );

    expect(before.every(({ blocker }) => !blocker)).toBe(true);
    expect(after.every(({ blocker }) => blocker === dialog)).toBe(true);
  });
});
