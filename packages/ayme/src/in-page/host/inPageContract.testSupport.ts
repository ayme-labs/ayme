import type { Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import type { ElementInputs, InPageHost, VisitSignal } from "./inPage";

/**
 * One runtime the in-page module's contract runs on: Playwright Lite in the
 * browser, or real Playwright in Node against the built package.
 */
export type InPageLane = {
  /** A page showing a fresh, empty document. */
  newPage(): Promise<Page>;
  /** A new host, other than every one before it, of `version` or else this package's. */
  createHost(page: Page, version?: string): InPageHost;
  /** Loads the page's document again and answers the Page that shows the next one. */
  reload(page: Page): Promise<Page>;
  /**
   * The Page that shows the next document `page` loads, once it has loaded:
   * asked before the page starts the load itself.
   */
  nextDocument(page: Page): Promise<Page>;
  /** Whether a host outlives a full load of its page, as a Node host does and the page's own runtime does not. */
  hostsOutliveLoads: boolean;
};

/** Replaces the page's body, in the page's own realm on either runtime. */
async function setBody(page: Page, html: string) {
  await page.evaluate(`document.body.innerHTML = ${JSON.stringify(html)}`);
}

/** The boxes Playwright draws now, one per highlighted element, in the lane's open overlay. */
async function highlightBoxes(page: Page) {
  return page.locator("x-pw-highlight").evaluateAll((boxes) =>
    boxes
      .map((box) => ({
        outlineStyle: (box as HTMLElement).style.outlineStyle,
        outlineColor: (box as HTMLElement).style.outlineColor,
        bounds: box.getBoundingClientRect().toJSON() as {
          x: number;
          y: number;
          width: number;
          height: number;
        },
        shown: (box as HTMLElement).style.display === "block",
      }))
      .filter(({ shown }) => shown)
  );
}

/** Every attribute of every element outside Playwright's overlay, to compare before and after. */
function appAttributes(page: Page) {
  return page.evaluate(`[...document.querySelectorAll("*")]
    .filter((element) => element.localName !== "x-pw-glass")
    .map((element) => [element.localName, ...[...element.attributes].map((a) => a.name + "=" + a.value)].join(" "))`);
}

/** Every Structural Ref a capture text prints, in order. */
function refsIn(text: string): string[] {
  return [...text.matchAll(/\[ref=([^\]]+)\]/g)].map(([, ref]) => ref!);
}

/** The ref `text` prints on the line naming `name`. */
function refOf(text: string, name: string): string {
  const line = text.split("\n").find((candidate) => candidate.includes(name));
  const ref = line && refsIn(line)[0];
  if (!ref) throw new Error(`No ref for ${name} in:\n${text}`);
  return ref;
}

/** The in-page module's contract, as every host sees it through `inPage(page)`. */
export function inPageContract(lane: InPageLane) {
  it("the first host installs the module and a later host binds to it", async () => {
    const page = await lane.newPage();
    const first = lane.createHost(page);
    const later = lane.createHost(page);

    const installed = await first.inPage(page).bound();
    const bound = await later.inPage(page).bound();

    expect(installed.installedBy).toBe(installed.host);
    expect(bound).toEqual({
      document: installed.document,
      version: installed.version,
      installedBy: installed.host,
      host: expect.any(String),
    });
    expect(bound.host).not.toBe(installed.host);
  });

  it("hosts that reach a document at once still share one module", async () => {
    const page = await lane.newPage();
    const hosts = [1, 2, 3].map(() => lane.createHost(page));

    const bound = await Promise.all(
      hosts.map((host) => host.inPage(page).bound())
    );

    expect(new Set(bound.map(({ document }) => document)).size).toBe(1);
    expect(new Set(bound.map(({ installedBy }) => installedBy)).size).toBe(1);
    expect(bound.map(({ host }) => host)).toContain(bound[0]!.installedBy);
  });

  it("a host has one InPage per Page and binds it as often as asked", async () => {
    const page = await lane.newPage();
    const host = lane.createHost(page);

    const first = await host.inPage(page).bound();
    const again = await host.inPage(page).bound();

    expect(host.inPage(page)).toBe(host.inPage(page));
    expect(again).toEqual(first);
  });

  it("a host of another version gets a version error, and the document keeps its one module", async () => {
    const page = await lane.newPage();
    const installed = await lane.createHost(page, "1.0.0").inPage(page).bound();

    await expect(
      lane.createHost(page, "2.0.0").inPage(page).bound()
    ).rejects.toMatchObject({
      name: "InPageVersionError",
      message:
        "This document runs Ayme's in-page module 1.0.0; this host is 2.0.0.",
    });
    const later = await lane.createHost(page, "1.0.0").inPage(page).bound();

    expect(later.document).toBe(installed.document);
    expect(later.installedBy).toBe(installed.host);
  });

  it("a page script cannot replace the module", async () => {
    const page = await lane.newPage();
    const installed = await lane.createHost(page).inPage(page).bound();

    // A string, so Playwright Lite runs it in the page's own realm too.
    const replaced = await page.evaluate(`(() => {
      const slot = Symbol.for("ayme.inPage");
      try {
        globalThis[slot] = undefined;
      } catch {
        // Strict code throws on the write; the module stays either way.
      }
      return Reflect.deleteProperty(globalThis, slot);
    })()`);
    const later = await lane.createHost(page).inPage(page).bound();

    expect(replaced).toBe(false);
    expect(later.document).toBe(installed.document);
    expect(later.installedBy).toBe(installed.host);
  });

  it("two pages have a module each", async () => {
    const [one, other] = [await lane.newPage(), await lane.newPage()];

    const [first, second] = [
      await lane.createHost(one).inPage(one).bound(),
      await lane.createHost(other).inPage(other).bound(),
    ];

    expect(second.document).not.toBe(first.document);
  });

  it("a full load gives the next document a new token and a module of its own", async () => {
    const page = await lane.newPage();
    const before = await lane.createHost(page).inPage(page).bound();

    const next = await lane.reload(page);
    const after = await lane.createHost(next).inPage(next).bound();

    expect(after.document).not.toBe(before.document);
    expect(after.installedBy).toBe(after.host);
  });

  it.runIf(lane.hostsOutliveLoads)(
    "a host that outlives a full load binds the next document, installing it there",
    async () => {
      const page = await lane.newPage();
      const host = lane.createHost(page);
      const before = await host.inPage(page).bound();

      const next = await lane.reload(page);
      const after = await host.inPage(next).bound();

      expect(after.document).not.toBe(before.document);
      expect(after.host).toBe(before.host);
      expect(after.installedBy).toBe(before.host);
    }
  );

  it("a capture gives the document's distilled and full text, a ref on every node", async () => {
    const page = await lane.newPage();
    await setBody(
      page,
      "<main><h1>Groceries</h1><p>Two items</p><button>Add item</button></main>"
    );
    const host = lane.createHost(page);

    const capture = await host.inPage(page).capture();

    expect(capture).toEqual({
      document: (await host.inPage(page).bound()).document,
      url: page.url(),
      distilledText: [
        "- main [ref=e2]:",
        '  - heading "Groceries" [level=1] [ref=e3]',
        "  - paragraph [ref=e4]: Two items",
        '  - button "Add item" [ref=e5]',
      ].join("\n"),
      fullText: expect.stringContaining('- button "Add item" [ref=e5]'),
      excludedRefs: [],
      roots: [],
    });
  });

  it("two hosts capturing one document over 100 additions never give two elements one ref", async () => {
    const page = await lane.newPage();
    await setBody(page, '<ul aria-label="Items"></ul>');
    const [one, other] = [lane.createHost(page), lane.createHost(page)];
    const refsByItem = new Map<string, string>();

    for (let item = 1; item <= 100; item += 1) {
      await page.evaluate(
        `document.querySelector("ul").insertAdjacentHTML("afterbegin", "<li><button>Item ${item}</button></li>")`
      );
      // Whichever host sees an element first mints its ref.
      const hosts = item % 2 ? [one, other] : [other, one];
      for (const host of hosts) {
        const { fullText } = await host.inPage(page).capture();
        const refs = refsIn(fullText);
        expect(new Set(refs).size, fullText).toBe(refs.length);
        for (let seen = 1; seen <= item; seen += 1) {
          const ref = refOf(fullText, `"Item ${seen}"`);
          expect(refsByItem.get(`Item ${seen}`) ?? ref).toBe(ref);
          refsByItem.set(`Item ${seen}`, ref);
        }
      }
    }
    expect(new Set(refsByItem.values()).size).toBe(100);
    // 300 round trips: about 3 s alone, so a loaded machine needs headroom.
  }, 20_000);

  it("a root without a node of its own gets one synthetic ref per element, whichever host labels it", async () => {
    const page = await lane.newPage();
    await setBody(
      page,
      '<div role="none" id="a"><button>One</button></div><div role="none" id="b"><button>Two</button></div>'
    );
    const [one, other] = [lane.createHost(page), lane.createHost(page)];
    const labelling = (labels: [string, string][]) =>
      page.evaluateHandle<ElementInputs>(
        `({ roots: ${JSON.stringify(labels)}.map(([label, id]) => ({ label, element: document.getElementById(id) })) })`
      );

    const first = await one
      .inPage(page)
      .capture({ elements: await labelling([["ListPage", "a"]]) });
    const second = await other
      .inPage(page)
      .capture({ elements: await labelling([["CartPage", "b"]]) });
    const both = await other.inPage(page).capture({
      elements: await labelling([
        ["CartPage", "b"],
        ["ListPage", "a"],
      ]),
    });

    const [listPage] = first.roots;
    const [cartPage] = second.roots;
    expect(listPage).toEqual({
      labels: ["ListPage"],
      syntheticRef: expect.stringMatching(/^s_/),
      descendantRefs: [refOf(first.fullText, '"One"')],
    });
    expect(cartPage).toEqual({
      labels: ["CartPage"],
      syntheticRef: expect.stringMatching(/^s_/),
      descendantRefs: [refOf(second.fullText, '"Two"')],
    });
    if (
      !listPage ||
      !cartPage ||
      !("syntheticRef" in listPage) ||
      !("syntheticRef" in cartPage)
    )
      throw new Error("Both roots are synthetic.");
    expect(cartPage.syntheticRef).not.toBe(listPage.syntheticRef);
    expect(
      both.roots.map((root) => "syntheticRef" in root && root.syntheticRef)
    ).toEqual([cartPage.syntheticRef, listPage.syntheticRef]);
    expect(
      await page.locator(`ayme-ref=${listPage.syntheticRef}`).getAttribute("id")
    ).toBe("a");
  });

  it("a capture leaves out the refs under what the host ignores and under its absent roots", async () => {
    const page = await lane.newPage();
    await setBody(
      page,
      '<button>Kept</button><aside id="ignored"><button>Ignored</button></aside><section id="absent" aria-label="Absent part"><button>Absent</button></section>'
    );
    const host = lane.createHost(page);

    const capture = await host.inPage(page).capture({
      elements: await page.evaluateHandle<ElementInputs>(
        '({ absent: [document.getElementById("absent")], ignores: (element) => element.id === "ignored" })'
      ),
    });

    expect(capture.excludedRefs).toEqual([
      refOf(capture.fullText, "complementary"),
      refOf(capture.fullText, '"Ignored"'),
      refOf(capture.fullText, 'region "Absent part"'),
      refOf(capture.fullText, '"Absent"'),
    ]);
  });

  it("ayme-ref resolves Ayme's refs, and Playwright's aria-ref only its own", async () => {
    const page = await lane.newPage();
    await setBody(page, "<button>First</button><button>Second</button>");
    const host = lane.createHost(page);
    const before = await host.inPage(page).capture();
    // Playwright's own snapshot sees an element Ayme has not, first.
    await page.evaluate(
      `document.body.insertAdjacentHTML("afterbegin", "<button>Early</button>")`
    );
    const playwright = await page.ariaSnapshot({ mode: "ai" });
    const after = await host.inPage(page).capture();

    const ayme = refOf(after.distilledText, '"First"');
    expect(ayme).toBe(refOf(before.distilledText, '"First"'));
    expect(await page.locator(`ayme-ref=${ayme}`).textContent()).toBe("First");
    const early = refOf(playwright, '"Early"');
    expect(await page.locator(`aria-ref=${early}`).textContent()).toBe("Early");
    // The same ref names another element in each world.
    expect(await page.locator(`ayme-ref=${early}`).textContent()).not.toBe(
      "Early"
    );
    expect(refOf(after.distilledText, '"Early"')).not.toBe(early);
    expect(await page.ariaSnapshot({ mode: "ai" })).toBe(playwright);
  });

  describe("reach", () => {
    const covered =
      '<button>Save</button><div role="dialog" aria-label="Cover" style="position:fixed;inset:0"></div>';

    /** The refs a capture of the page's body gave, by what its line names. */
    async function reachPage(html: string) {
      const page = await lane.newPage();
      await setBody(page, html);
      const inPageOf = lane.createHost(page).inPage(page);
      const { fullText } = await inPageOf.capture();
      return { page, inPageOf, ref: (name: string) => refOf(fullText, name) };
    }

    it("a button nothing covers is present and available", async () => {
      const { inPageOf, ref } = await reachPage("<button>Save</button>");

      expect(await inPageOf.measureReach(ref('"Save"'))).toEqual({
        present: true,
        available: true,
      });
    });

    it("a button covered by an overlay is unavailable, and the overlay's ref names what is in the way", async () => {
      const { inPageOf, ref } = await reachPage(covered);

      expect(await inPageOf.measureReach(ref('"Save"'))).toEqual({
        present: true,
        available: false,
        hit: [ref("dialog")],
      });
    });

    it("an element nothing lays out any more is absent", async () => {
      const { page, inPageOf, ref } = await reachPage("<button>Gone</button>");
      await page.evaluate(
        `document.querySelector("button").style.display = "none"`
      );

      expect(await inPageOf.measureReach(ref('"Gone"'))).toEqual({
        present: false,
        available: false,
      });
    });

    it("what is in the way is named from the hit up to what holds the element, whether or not it has a node", async () => {
      const { page, inPageOf, ref } = await reachPage(
        '<button>Save</button><div id="plain" style="position:fixed;inset:0"><span id="inner" style="display:block;height:100%"></span></div>'
      );

      const { hit } = await inPageOf.measureReach(ref('"Save"'));
      const named = await Promise.all(
        (hit ?? []).map((ref) =>
          page.locator(`ayme-ref=${ref}`).evaluate((element) => element.id)
        )
      );

      expect(named).toEqual(["inner", "plain"]);
    });

    it("an open native modal blocks an element outside it, by the modal's ref", async () => {
      const { page, inPageOf, ref } = await reachPage(
        '<button>Behind</button><dialog aria-label="Modal"><button>Inside</button></dialog>'
      );
      await page.evaluate(`document.querySelector("dialog").showModal()`);
      const { fullText } = await inPageOf.capture();

      expect(await inPageOf.measureReach(ref('"Behind"'))).toEqual({
        present: true,
        available: false,
        blocker: refOf(fullText, 'dialog "Modal"'),
      });
      expect(await inPageOf.blockingAncestor(ref('"Behind"'))).toBe(
        refOf(fullText, 'dialog "Modal"')
      );
      expect(
        await inPageOf.blockingAncestor(refOf(fullText, '"Inside"'))
      ).toBeUndefined();
    });

    it("an inert ancestor blocks its content, by its own ref", async () => {
      const { inPageOf, ref } = await reachPage(
        '<section inert aria-label="Frozen"><button>Stuck</button></section>'
      );

      expect(await inPageOf.measureReach(ref('"Stuck"'))).toEqual({
        present: true,
        available: false,
        blocker: ref('region "Frozen"'),
      });
    });

    it("a blocker with no node of its own is named by a ref the ayme-ref engine resolves", async () => {
      const { page, inPageOf, ref } = await reachPage(
        '<div id="frozen" inert><button>Stuck</button></div>'
      );

      const { blocker } = await inPageOf.measureReach(ref('"Stuck"'));

      expect(await page.locator(`ayme-ref=${blocker}`).getAttribute("id")).toBe(
        "frozen"
      );
    });

    it("at call time the element is scrolled into view first, and an overlay over the place it lands is found", async () => {
      const { inPageOf, ref } = await reachPage(
        '<div style="height:3000px"></div><button>Far</button><div role="dialog" aria-label="Cover" style="position:fixed;inset:0"></div>'
      );

      expect(
        await inPageOf.measureReach(ref('"Far"'), { atCall: true })
      ).toEqual({ present: true, available: false, hit: [ref("dialog")] });
    });
  });
  describe("highlights", () => {
    const style = { outline: "2px dashed rgb(217, 164, 65)" };

    it("a locator's highlight draws a box over its element and its disposable clears it", async () => {
      const page = await lane.newPage();
      await setBody(page, "<button>First</button><button>Second</button>");
      const host = lane.createHost(page);
      const { fullText } = await host.inPage(page).capture();

      const highlight = await page
        .locator(`ayme-ref=${refOf(fullText, '"Second"')}`)
        .highlight({ style });

      const second = await page
        .getByRole("button", { name: "Second" })
        .boundingBox();
      await expect
        .poll(() => highlightBoxes(page))
        .toEqual([
          {
            outlineStyle: "dashed",
            outlineColor: "rgb(217, 164, 65)",
            bounds: expect.objectContaining({ x: second!.x, y: second!.y }),
            shown: true,
          },
        ]);
      await highlight.dispose();
      await expect.poll(() => highlightBoxes(page)).toEqual([]);
    });

    it("the app's DOM gains no attribute while an element is highlighted, and page.hideHighlight clears it", async () => {
      const page = await lane.newPage();
      await setBody(
        page,
        "<main><button>Save</button><input aria-label='Title'></main>"
      );
      const host = lane.createHost(page);
      const { fullText } = await host.inPage(page).capture();
      const before = await appAttributes(page);

      await page
        .locator(`ayme-ref=${refOf(fullText, '"Save"')}`)
        .highlight({ style });
      await page
        .locator(`ayme-ref=${refOf(fullText, '"Title"')}`)
        .highlight({ style: { outline: "3px solid red" } });

      await expect
        .poll(async () => (await highlightBoxes(page)).length)
        .toBe(2);
      expect(await appAttributes(page)).toEqual(before);
      await page.hideHighlight();
      await expect.poll(() => highlightBoxes(page)).toEqual([]);
      expect(await appAttributes(page)).toEqual(before);
    });
  });

  describe("picking", () => {
    const amber = "rgb(217, 164, 65)";
    const grey = "rgb(156, 163, 175)";
    const bodyOfPicking =
      '<main id="app"><input aria-label="New item"><button><span>Add item</span></button></main><aside id="panel"><button>Panel</button></aside>';

    /** A page with picking's fixture, its capture's refs by accessible name and the host. */
    async function picking() {
      const page = await lane.newPage();
      await setBody(page, bodyOfPicking);
      // What the page itself hears of the pointer.
      await page.evaluate(`(() => {
        window.presses = [];
        for (const type of ["pointerdown", "mousedown", "mouseup", "click", "contextmenu"])
          document.addEventListener(type, (event) => window.presses.push(type + ":" + event.target.textContent));
      })()`);
      const host = lane.createHost(page);
      const { fullText } = await host.inPage(page).capture();
      return {
        page,
        inPage: host.inPage(page),
        refs: {
          input: refOf(fullText, '"New item"'),
          button: refOf(fullText, '"Add item"'),
          panel: refOf(fullText, '"Panel"'),
        },
      };
    }

    it("returns the ref of the accepted element clicked, and the page never sees the press", async () => {
      const { page, inPage, refs } = await picking();

      const picked = inPage.pick([refs.input]);
      await page.getByLabel("New item").click();

      expect(await picked).toBe(refs.input);
      expect(await page.evaluate("window.presses")).toEqual([]);
    });

    it("greys an element that is not accepted and does not pick it, and boxes an accepted one", async () => {
      const { page, inPage, refs } = await picking();
      const picked = inPage.pick([refs.input]);
      let settled = false;
      void picked.then(() => (settled = true));

      // The pointer lands on the button's text; its button carries the ref.
      await page.getByText("Add item").hover();
      await expect
        .poll(async () =>
          (await highlightBoxes(page)).map((box) => box.outlineColor)
        )
        .toEqual([grey]);
      await page.getByText("Add item").click();
      await page.getByLabel("New item").hover();
      await expect
        .poll(async () =>
          (await highlightBoxes(page)).map((box) => box.outlineColor)
        )
        .toEqual([amber]);

      expect(settled).toBe(false);
      expect(await page.evaluate("window.presses")).toEqual([]);
      await page.getByLabel("New item").click();
      expect(await picked).toBe(refs.input);
    });

    it("leaves what the host ignores alone, and Esc cancels, then presses reach the page again", async () => {
      const { page, inPage, refs } = await picking();
      const picked = inPage.pick([refs.input], { ignore: "#panel" });

      await page.getByRole("button", { name: "Panel" }).click();
      expect(await page.evaluate("window.presses")).toContain("click:Panel");
      await page.keyboard.press("Escape");

      expect(await picked).toBeUndefined();
      await page.getByRole("button", { name: "Add item" }).click();
      expect(await page.evaluate("window.presses")).toContain("click:Add item");
      await expect.poll(() => highlightBoxes(page)).toEqual([]);
    });

    it("an abort right after pick is called still cancels it, and the page handles a click normally", async () => {
      const { page, inPage, refs } = await picking();
      const before = await page.evaluate("document.head.innerHTML");
      const stop = new AbortController();

      const picked = inPage.pick([refs.input], { signal: stop.signal });
      stop.abort();

      expect(await picked).toBeUndefined();
      await page.getByRole("button", { name: "Add item" }).click();
      expect(await page.evaluate("window.presses")).toContain("click:Add item");
      expect(await page.evaluate("document.head.innerHTML")).toBe(before);
    });

    it("stops when its signal aborts, and leaves no style behind", async () => {
      const { page, inPage, refs } = await picking();
      const before = await page.evaluate("document.head.innerHTML");
      const stop = new AbortController();
      const picked = inPage.pick([refs.input], { signal: stop.signal });
      await expect
        .poll(() => page.evaluate("document.head.innerHTML"))
        .not.toBe(before);

      stop.abort();

      expect(await picked).toBeUndefined();
      expect(await page.evaluate("document.head.innerHTML")).toBe(before);
    });
  });

  it("a click cue shows at the centre of the element a locator matches, then goes", async () => {
    const page = await lane.newPage();
    await setBody(
      page,
      '<button style="position:fixed;left:40px;top:60px;width:100px;height:30px">Go</button>'
    );
    const inPage = lane.createHost(page).inPage(page);

    const cue = inPage.cue(page.getByRole("button", { name: "Go" }));

    const where = page.locator("[data-demo-click-cue]");
    await expect.poll(() => where.count()).toBe(1);
    expect(
      await where.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return [box.x + box.width / 2, box.y + box.height / 2].map(Math.round);
      })
    ).toEqual([90, 75]);
    await cue;
    expect(await where.count()).toBe(0);
    // Nothing matches: no cue, and no wait.
    await inPage.cue(page.getByRole("button", { name: "Missing" }));
  });

  it("an action answers the Settled Page after it, once the activity it set off has gone quiet", async () => {
    const page = await lane.newPage();
    await setBody(page, '<button>Add</button><ul aria-label="Items"></ul>');
    // One item every 100 ms, the last 500 ms after the click: each extends
    // the quiet window the Settled Page waits for.
    await page.evaluate(`document.querySelector("button").addEventListener("click", () => {
      for (let item = 1; item <= 5; item += 1)
        setTimeout(() => document.querySelector("ul").insertAdjacentHTML("beforeend", "<li>Item " + item + "</li>"), item * 100);
    })`);
    const host = lane.createHost(page);

    const action = await host.inPage(page).begin();
    const outcome = await action.perform(async () => {
      await page.locator("button").click();
      return "clicked";
    });

    expect(action.before).toMatchObject({
      document: (await host.inPage(page).bound()).document,
      url: page.url(),
    });
    expect(action.before.distilledText).not.toContain("listitem");
    expect(outcome).toEqual({
      kind: "settled",
      result: "clicked",
      stable: true,
      after: expect.objectContaining({
        document: action.before.document,
        url: page.url(),
      }),
    });
    if (outcome.kind !== "settled") throw new Error("The action settled.");
    expect(refsIn(outcome.after.distilledText)).toHaveLength(8);
    expect(outcome.after.distilledText).toContain(
      `- listitem [ref=${refOf(outcome.after.distilledText, "Item 5")}]: Item 5`
    );
  });

  it("an action whose perform throws answers the error with the page settled after it", async () => {
    const page = await lane.newPage();
    await setBody(page, "<main><h1>Saving</h1></main>");
    const host = lane.createHost(page);
    const failure = new Error("Save failed.");

    const action = await host.inPage(page).begin();
    const outcome = await action.perform(async () => {
      await page.evaluate(
        `setTimeout(() => document.querySelector("main").insertAdjacentHTML("beforeend", "<p>Not saved</p>"), 100)`
      );
      throw failure;
    });

    expect(outcome).toEqual({
      kind: "threw",
      error: failure,
      stable: true,
      after: expect.objectContaining({
        document: action.before.document,
        distilledText: expect.stringContaining("Not saved"),
      }),
    });
  });

  it("an action that starts a full load answers the load with the old document's last capture, and the next capture is of a new document", async () => {
    const page = await lane.newPage();
    await setBody(page, "<p>Staying</p><button>Reload</button>");
    await page.evaluate(`document.querySelector("button").addEventListener("click", () => {
      document.querySelector("p").textContent = "Leaving";
      location.reload();
    })`);
    const url = page.url();
    const host = lane.createHost(page);
    const next = lane.nextDocument(page);

    const action = await host.inPage(page).begin();
    const outcome = await action.perform(() => page.locator("button").click());

    expect(outcome).toEqual({
      kind: "loading",
      url,
      after: expect.objectContaining({
        document: action.before.document,
        distilledText: expect.stringContaining("Leaving"),
      }),
    });
    const nextPage = await next;
    const capture = await lane.createHost(nextPage).inPage(nextPage).capture();
    expect(capture.document).not.toBe(action.before.document);
  });

  it("every host bound to a document hears of it, and of each same-document navigation in it", async () => {
    const page = await lane.newPage();
    const [one, other] = [lane.createHost(page), lane.createHost(page)];
    const heard = new Map<InPageHost, VisitSignal[]>([
      [one, []],
      [other, []],
    ]);
    for (const [host, visits] of heard)
      host.inPage(page).onVisit((visit) => visits.push(visit));
    const { document } = await one.inPage(page).bound();
    await other.inPage(page).bound();
    const url = page.url();

    await page.evaluate(`location.hash = "details"`);

    for (const visits of heard.values())
      await expect
        .poll(() => visits)
        .toEqual([
          { document, url, cause: "initial" },
          { document, url: `${url}#details`, cause: "navigate" },
        ]);
  });

  it("a listener that stops hears of no later navigation", async () => {
    const page = await lane.newPage();
    const host = lane.createHost(page);
    const [stopped, listening]: VisitSignal["cause"][][] = [[], []];
    const stop = host.inPage(page).onVisit(({ cause }) => stopped.push(cause));
    host.inPage(page).onVisit(({ cause }) => listening.push(cause));
    await host.inPage(page).bound();

    stop();
    await page.evaluate(`location.hash = "details"`);

    await expect.poll(() => listening).toEqual(["initial", "navigate"]);
    expect(stopped).toEqual(["initial"]);
  });

  it.runIf(lane.hostsOutliveLoads)(
    "a host that outlives a full load hears of the next document once it has loaded",
    async () => {
      const page = await lane.newPage();
      const host = lane.createHost(page);
      const visits: VisitSignal[] = [];
      host.inPage(page).onVisit((visit) => visits.push(visit));
      const before = await host.inPage(page).bound();

      await lane.reload(page);

      await expect
        .poll(() => visits.map(({ cause }) => cause))
        .toEqual(["initial", "initial"]);
      expect(visits[1]!.document).not.toBe(before.document);
      expect(visits[1]!.url).toBe(page.url());
    }
  );
}
