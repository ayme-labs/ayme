import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPage } from "./browserPage";
import { listElementTools } from "./browserTools";
import { reaches } from "./elementReach";
import { errorText } from "./errors";
import { buildToolOptions } from "./goalLoopOperations";
import { planArguments } from "./goalLoopQuestions";
import { lookAtPageStateForDocument } from "./pageState";
import { agentTools } from "./publication.testSupport";
import { listElementToolTargets } from "./publishedTools";
import { requireAymeRuntimePage } from "./registry";
import { createAyme } from "./runtime";

// A refusal answers before Playwright's actionability wait would time out.
const ACTION_TIMEOUT = 500;

const RENAME_DIALOG = `
  <ul>
    <li>Alpha <button id="rename" type="button">Rename</button></li>
  </ul>
  <input id="search" aria-label="Search">
  <dialog id="dialog" aria-label="Rename project">
    <input id="name" aria-label="Name">
    <input id="note" aria-label="Note">
    <button id="confirm" type="button">Confirm</button>
  </dialog>
`;

// Browser Tools offer and accept elements by playwright-lite's own hit test
// at the point it would click (ADR-0041): an element shown now is tested
// where it is; one below the fold is offered, and tested once the call has
// scrolled to it.
describe("Browser Tools on elements a click would not reach, in Chromium", () => {
  let stop: () => void;
  let listening: AbortController;
  const clicks: string[] = [];

  beforeEach(() => {
    clicks.length = 0;
    listening = new AbortController();
    document.addEventListener(
      "click",
      (event) => clicks.push((event.target as Element).id),
      { capture: true, signal: listening.signal }
    );
    const ayme = createAyme({
      pageFactory: () => createPage({ actionTimeout: ACTION_TIMEOUT }),
    });
    stop = ayme.start();
  });

  afterEach(() => {
    listening.abort();
    stop();
    document.body.innerHTML = "";
    window.scrollTo(0, 0);
  });

  const call = (name: string, input: unknown) => agentTools().call(name, input);

  async function snapshot() {
    const { structure } = (await call("snapshot", {})) as {
      structure: string;
    };
    return structure;
  }

  async function refOf(role: string, label: string) {
    const ref = (await snapshot()).match(
      new RegExp(`(e\\d+) ${role} "${label}"`)
    )?.[1];
    if (!ref) throw new Error(`Expected a Structural Ref for ${label}.`);
    return ref;
  }

  /** The tool's refusal of `ref`, and how long it took. */
  async function refusal(tool: string, ref: string) {
    const started = performance.now();
    const error = await call(tool, { target: ref }).then(
      () => "no error",
      errorText
    );
    return { error, elapsed: performance.now() - started };
  }

  function openRenameDialog() {
    document.body.innerHTML = RENAME_DIALOG;
    document.querySelector<HTMLDialogElement>("#dialog")!.showModal();
  }

  it("offers the open modal's controls, not the row's Rename behind it", async () => {
    openRenameDialog();
    const targets = await listElementToolTargets();
    const [rename, name, confirm] = await Promise.all([
      refOf("button", "Rename"),
      refOf("textbox", "Name"),
      refOf("button", "Confirm"),
    ]);

    for (const tool of ["click", "hover"]) {
      expect(targets.get(tool), tool).toContain(confirm);
      expect(targets.get(tool), tool).toContain(name);
      expect(targets.get(tool), tool).not.toContain(rename);
    }
    for (const tool of ["fill", "type"]) {
      expect(targets.get(tool), tool).toContain(name);
      expect(targets.get(tool), tool).not.toContain(
        await refOf("textbox", "Search")
      );
    }
  });

  it("refuses a click behind the open modal at once, naming the dialog", async () => {
    openRenameDialog();
    const rename = await refOf("button", "Rename");
    // The dialog has an accessible name, so the snapshot gives it a ref.
    const dialog = await refOf("dialog", "Rename project");

    const { error, elapsed } = await refusal("click", rename);

    expect(error).toBe(
      `RuntimeStateError: click is unavailable: a click would not reach it; ${dialog} is in the way.`
    );
    expect(clicks).toEqual([]);
    expect(elapsed).toBeLessThan(ACTION_TIMEOUT / 2);
  });

  it("still clicks the modal's own button", async () => {
    openRenameDialog();
    await call("click", { target: await refOf("button", "Confirm") });
    expect(clicks).toEqual(["confirm"]);
  });

  it("neither offers nor clicks a button under an inert ancestor", async () => {
    document.body.innerHTML = `
      <div inert><button id="save" type="button">Save</button></div>
    `;
    const save = await refOf("button", "Save");

    expect((await listElementToolTargets()).get("click")).not.toContain(save);
    const { error, elapsed } = await refusal("click", save);
    // The inert ancestor is a plain div: no ref to name.
    expect(error).toBe(
      "RuntimeStateError: click is unavailable: a click would not reach it."
    );
    expect(clicks).toEqual([]);
    expect(elapsed).toBeLessThan(ACTION_TIMEOUT / 2);
  });

  it.each([
    [
      "a plain overlay, which has no ref",
      `<div id="overlay"></div>`,
      undefined,
    ],
    [
      "a named overlay",
      `<div id="overlay" role="dialog" aria-label="Saving"></div>`,
      "Saving",
    ],
  ])(
    "neither offers nor clicks a button under %s",
    async (_kind, overlay, overlayLabel) => {
      document.body.innerHTML = `
        <style>
          #overlay { position: fixed; inset: 0; background: rgb(0 0 0 / 0.3); }
        </style>
        <button id="save" type="button">Save</button>
        ${overlay}
      `;
      const save = await refOf("button", "Save");
      const inTheWay =
        overlayLabel === undefined
          ? ""
          : `; ${await refOf("dialog", overlayLabel)} is in the way`;

      expect((await listElementToolTargets()).get("click")).not.toContain(save);
      const { error, elapsed } = await refusal("click", save);
      expect(error).toBe(
        `RuntimeStateError: click is unavailable: a click would not reach it${inTheWay}.`
      );
      expect(clicks).toEqual([]);
      expect(elapsed).toBeLessThan(ACTION_TIMEOUT / 2);
    }
  );

  // The drift of ayme-labs/ayme#828: the button was offered because a corner
  // of it was bare, and the click, which lands at its centre, timed out.
  it("neither offers nor clicks a button covered only where the click would land, naming the cover", async () => {
    document.body.innerHTML = `
      <style>
        #save { position: fixed; left: 0; top: 0; width: 200px; height: 40px; }
        #badge { position: fixed; left: 90px; top: 10px; width: 20px; height: 20px; }
      </style>
      <button id="save" type="button">Save</button>
      <div id="badge" role="status" aria-label="Saving"></div>
    `;
    const save = await refOf("button", "Save");
    const badge = await refOf("status", "Saving");

    expect((await listElementToolTargets()).get("click")).not.toContain(save);
    const { error, elapsed } = await refusal("click", save);
    expect(error).toBe(
      `RuntimeStateError: click is unavailable: a click would not reach it; ${badge} is in the way.`
    );
    expect(clicks).toEqual([]);
    expect(elapsed).toBeLessThan(ACTION_TIMEOUT / 2);
  });

  it("offers a button covered away from where the click would land, and clicks it", async () => {
    document.body.innerHTML = `
      <style>
        #save { position: fixed; left: 0; top: 0; width: 200px; height: 40px; }
        #badge { position: fixed; left: 0; top: 0; width: 20px; height: 20px; }
      </style>
      <button id="save" type="button">Save</button>
      <div id="badge"></div>
    `;
    const save = await refOf("button", "Save");

    expect((await listElementToolTargets()).get("click")).toContain(save);
    await call("click", { target: save });
    expect(clicks).toEqual(["save"]);
  });

  it("offers a button below the fold and clicks it, scrolling to it first", async () => {
    document.body.innerHTML = `
      <div style="height: 3000px"></div>
      <button id="save" type="button">Save</button>
    `;
    const save = await refOf("button", "Save");

    expect((await listElementToolTargets()).get("click")).toContain(save);
    expect(window.scrollY).toBe(0);
    await call("click", { target: save });
    expect(clicks).toEqual(["save"]);
    expect(window.scrollY).toBeGreaterThan(0);
  });

  it("offers a button below the fold that is covered where it will land, and refuses the click at once after the scroll, naming the cover", async () => {
    document.body.innerHTML = `
      <style>
        #band { position: fixed; left: 0; right: 0; top: 30%; height: 40%; }
      </style>
      <div style="height: 3000px"></div>
      <button id="save" type="button">Save</button>
      <div style="height: 3000px"></div>
      <div id="band" role="dialog" aria-label="Saving"></div>
    `;
    const save = await refOf("button", "Save");
    const band = await refOf("dialog", "Saving");

    // Nothing shows of it now, so there is no point to hit-test yet.
    expect((await listElementToolTargets()).get("click")).toContain(save);
    const { error, elapsed } = await refusal("click", save);
    expect(error).toBe(
      `RuntimeStateError: click is unavailable: a click would not reach it; ${band} is in the way.`
    );
    expect(clicks).toEqual([]);
    expect(window.scrollY).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(ACTION_TIMEOUT / 2);
  });

  it("sees an overlay removed between two listings in the same task", async () => {
    document.body.innerHTML = `
      <style>
        #overlay { position: fixed; inset: 0; background: rgb(0 0 0 / 0.3); }
      </style>
      <button id="save" type="button">Save</button>
      <div id="overlay"></div>
    `;
    const save = await refOf("button", "Save");
    const capture = await lookAtPageStateForDocument(document);

    const covered = listElementToolTargets(capture);
    document.querySelector("#overlay")!.remove();
    const uncovered = listElementToolTargets(capture);

    expect((await covered).get("click")).not.toContain(save);
    expect((await uncovered).get("click")).toContain(save);
  });

  it("fails fill_form at a field behind the open modal and keeps the fields filled before it", async () => {
    openRenameDialog();
    const dialog = await refOf("dialog", "Rename project");

    const result = await call("fill_form", {
      fields: [
        { target: "#name", name: "Name", type: "textbox", value: "Beta" },
        { target: "#search", name: "Search", type: "textbox", value: "x" },
        { target: "#note", name: "Note", type: "textbox", value: "n" },
      ],
    });

    expect(result).toMatchObject({
      result: {
        filled: ["Name"],
        failed: {
          name: "Search",
          error: `fill_form is unavailable: it cannot take focus; ${dialog} is in the way.`,
        },
      },
    });
    const value = (selector: string) =>
      document.querySelector<HTMLInputElement>(selector)!.value;
    expect(value("#name")).toBe("Beta");
    expect(value("#search")).toBe("");
    expect(value("#note")).toBe("");
  });

  // A custom checkbox: the input transparent beside the styled box, so the
  // click, at the input's centre, reaches it.
  it("offers and checks a transparent checkbox the styled box sits beside", async () => {
    document.body.innerHTML = `
      <style>
        .box { display: inline-block; width: 20px; height: 20px; border: 1px solid; margin-left: 24px; }
      </style>
      <label>
        <input id="agree" type="checkbox" style="opacity: 0; position: absolute">
        <span class="box"></span> Agree
      </label>
    `;
    const agree = await refOf("checkbox", "Agree");

    expect((await listElementToolTargets()).get("check")).toContain(agree);
    await call("check", { target: agree });
    expect(document.querySelector<HTMLInputElement>("#agree")!.checked).toBe(
      true
    );
  });

  it("offers and fills a field under an overlay, which a click would not reach", async () => {
    document.body.innerHTML = `
      <style>
        #overlay { position: fixed; inset: 0; background: rgb(0 0 0 / 0.3); }
      </style>
      <input id="name" aria-label="Name">
      <div id="overlay"></div>
    `;
    const name = await refOf("textbox", "Name");

    const targets = await listElementToolTargets();
    expect(targets.get("fill")).toContain(name);
    expect(targets.get("click")).not.toContain(name);
    await call("fill", { target: name, text: "Beta" });
    expect(document.querySelector<HTMLInputElement>("#name")!.value).toBe(
      "Beta"
    );
  });

  it("neither offers nor clicks a shown button without pointer events, naming its ancestor", async () => {
    document.body.innerHTML = `
      <div role="region" aria-label="Footer">
        <button id="ghost" type="button" style="pointer-events: none">Ghost</button>
      </div>
      <div style="height: 3000px"></div>
    `;
    const ghost = await refOf("button", "Ghost");
    const footer = await refOf("region", "Footer");

    expect((await listElementToolTargets()).get("click")).not.toContain(ghost);
    const { error, elapsed } = await refusal("click", ghost);
    // What a click hits instead is the button's ancestor.
    expect(error).toBe(
      `RuntimeStateError: click is unavailable: a click would not reach it; ${footer} is in the way.`
    );
    expect(clicks).toEqual([]);
    expect(elapsed).toBeLessThan(ACTION_TIMEOUT / 2);
  });

  it("offers a button without pointer events below the fold, and refuses the click at once after the scroll, naming its ancestor", async () => {
    document.body.innerHTML = `
      <div style="height: 3000px"></div>
      <div role="region" aria-label="Footer">
        <button id="ghost" type="button" style="pointer-events: none">Ghost</button>
      </div>
    `;
    const ghost = await refOf("button", "Ghost");
    const footer = await refOf("region", "Footer");

    expect((await listElementToolTargets()).get("click")).toContain(ghost);
    const { error, elapsed } = await refusal("click", ghost);
    expect(error).toBe(
      `RuntimeStateError: click is unavailable: a click would not reach it; ${footer} is in the way.`
    );
    expect(clicks).toEqual([]);
    expect(window.scrollY).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(ACTION_TIMEOUT / 2);
  });

  // The Inspector's panel takes pointer events, but lets a runtime action
  // through while its target is under it, so it is never in the way.
  it("does not count the Inspector host as in the way", async () => {
    document.body.innerHTML = `
      <button id="save" type="button" style="position: fixed; left: 0; top: 0">Save</button>
      <ayme-inspector data-ayme-inspector-host style="position: fixed; inset: 0; pointer-events: none; z-index: 2147483647"></ayme-inspector>
    `;
    const host = document.querySelector("ayme-inspector")!;
    host.attachShadow({ mode: "closed" }).innerHTML =
      `<div style="position: fixed; inset: 0; pointer-events: auto; background: white"></div>`;
    const save = document.querySelector("#save")!;
    expect(document.elementFromPoint(20, 10)).toBe(host);

    expect(reaches(requireAymeRuntimePage(), save, "click")).toBe(true);
    expect((await listElementToolTargets()).get("click")).toContain(
      await refOf("button", "Save")
    );
  });

  // Playwright's own check never reached these either: the box takes the
  // click, or the clip leaves nothing to click. The tool refuses at once
  // instead of timing out.
  it.each([
    [
      "the styled box covers whole",
      `<label style="position: relative; display: inline-block; padding-left: 30px">
        <input id="agree" type="checkbox"
          style="opacity: 0; position: absolute; top: 0; left: 0; margin: 0; width: 24px; height: 24px">
        <span style="position: absolute; top: 0; left: 0; width: 24px; height: 24px; background: white"></span>
        Agree
      </label>`,
    ],
    [
      "is visually hidden",
      `<label>
        <input id="agree" type="checkbox"
          style="position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%)">
        Agree
      </label>`,
    ],
  ])("neither offers nor checks a checkbox that %s", async (_kind, html) => {
    document.body.innerHTML = `<div style="padding: 20px">${html}</div>`;
    const agree = await refOf("checkbox", "Agree");

    expect((await listElementToolTargets()).get("check")).not.toContain(agree);
    const { error, elapsed } = await refusal("check", agree);
    expect(error).toBe(
      "RuntimeStateError: check is unavailable: a click would not reach it."
    );
    expect(document.querySelector<HTMLInputElement>("#agree")!.checked).toBe(
      false
    );
    expect(elapsed).toBeLessThan(ACTION_TIMEOUT / 2);
  });
});

describe("Element reach timing in Chromium", () => {
  let stop: () => void;

  beforeEach(() => {
    stop = createAyme({
      pageFactory: () => createPage({ actionTimeout: ACTION_TIMEOUT }),
    }).start();
  });

  afterEach(() => {
    stop();
    document.body.innerHTML = "";
  });

  const BUTTONS = 200;

  type Cover = "none" | "modal" | "overlay";

  function longList(cover: Cover) {
    document.body.innerHTML = `
      <input aria-label="Search"><input aria-label="Filter">
      <select aria-label="Sort"><option>Name</option></select>
      <label><input type="checkbox"> Archived</label>
      <ul>${Array.from(
        { length: BUTTONS },
        (_, index) => `<li><button type="button">Item ${index}</button></li>`
      ).join("")}</ul>
      <dialog><button type="button">Close</button></dialog>
      ${cover === "overlay" ? `<div style="position: fixed; inset: 0"></div>` : ""}
    `;
    if (cover === "modal") document.querySelector("dialog")!.showModal();
  }

  async function medianMs(run: () => unknown, runs = 5) {
    const times: number[] = [];
    for (let index = 0; index < runs; index++) {
      const started = performance.now();
      await run();
      times.push(performance.now() - started);
    }
    return times.sort((a, b) => a - b)[Math.floor(runs / 2)]!;
  }

  // An open modal blocks every click before any hit-testing; a plain overlay
  // is hit at the click point of every element shown now, and leaves the
  // ones below the fold to the call.
  it.each([
    ["uncovered", "none"],
    ["behind an open modal", "modal"],
    ["under a fixed overlay", "overlay"],
  ] as const)(
    "lists and plans the click targets of 200 buttons %s",
    async (kind, cover) => {
      longList(cover);
      const capture = await lookAtPageStateForDocument(document);
      const click = buildToolOptions().find(({ key }) => key === "click")!;
      const targetOnly = {
        ...click.tool,
        args: click.tool.args.filter((arg) => arg.name === "target"),
        requiredParams: ["target"],
      };
      const page = requireAymeRuntimePage();

      const listing = await medianMs(() => listElementToolTargets(capture));
      const planning = await medianMs(() => planArguments(targetOnly, capture));
      const measuring = await medianMs(() => {
        for (const element of capture.elementsByRef.values())
          reaches(page, element, "click");
      });
      const offered = (await listElementToolTargets(capture)).get("click")!;

      console.log(
        `${BUTTONS} buttons ${kind}: listElementToolTargets ${listing.toFixed(1)}ms, ` +
          `planArguments(click) ${planning.toFixed(1)}ms, ` +
          `reaches over all ${capture.elementsByRef.size} refs ${measuring.toFixed(1)}ms, ` +
          `median of 5; ${offered.length} click targets`
      );
      const { matches } = listElementTools().find(
        ({ tool }) => tool.name === "click"
      )!;
      const belowTheFold = [...capture.elementsByRef.values()].filter(
        (element) =>
          matches!(element) &&
          element.getBoundingClientRect().top >=
            document.documentElement.clientHeight
      );
      expect(belowTheFold.length).toBeGreaterThan(0);
      expect(offered.length).toBe(
        cover === "none"
          ? BUTTONS + 4
          : cover === "modal"
            ? 1
            : belowTheFold.length
      );
      // Loose, so a slow CI runner does not fail it.
      expect(listing).toBeLessThan(5000);
      expect(planning).toBeLessThan(5000);
      expect(measuring).toBeLessThan(5000);
    },
    60_000
  );
});
