import { afterEach, describe, expect, it, vi } from "vitest";

import { inPage } from "../../in-page";
import { createPage } from "../../page-objects/infrastructure";
import { geometryReach } from "./reachMeasurement";

const ROWS = 200;

describe("A batch reach pass, in Chromium", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  /** The refs of the rows' buttons, named in the page. */
  async function renderRows() {
    document.body.innerHTML = `<ul>${Array.from(
      { length: ROWS },
      (_, index) => `<li><button type="button">Row ${index}</button></li>`
    ).join(
      ""
    )}</ul><dialog id="dialog"><button type="button">Close</button></dialog>`;
    const page = createPage();
    return {
      page,
      refs: await inPage(page).mint(page.locator("li button")),
    };
  }

  function countModalQueries() {
    const querySelectorAll = vi.spyOn(Document.prototype, "querySelectorAll");
    return () =>
      querySelectorAll.mock.calls.filter(
        ([selectors]) => selectors === ":modal"
      ).length;
  }

  it("asks the document for its open modals once, for every element it measures", async () => {
    const { page, refs } = await renderRows();
    const modalQueries = countModalQueries();

    await geometryReach.reachable(page, refs, "click");

    expect(modalQueries()).toBe(1);
  });

  it("sees a modal opened after an earlier pass", async () => {
    const { page, refs } = await renderRows();
    const dialog = document.getElementById("dialog") as HTMLDialogElement;

    const before = await geometryReach.reachable(page, refs, "click");
    dialog.showModal();
    const after = await geometryReach.reachable(page, refs, "click");

    expect(before).toEqual(refs);
    expect(after).toEqual([]);
  });
});
