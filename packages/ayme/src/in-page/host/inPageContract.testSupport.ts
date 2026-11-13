import type { Locator, Page } from "@playwright/test";
import { describe, expect, it, onTestFinished } from "vitest";

import { PREDICATES, type Predicate } from "../../shared";
import type { ElementInputs, InPage, InPageHost, VisitSignal } from "./inPage";
import type {
  PageObjectConstructor,
  createPomRegistry,
  registerCompiledPom,
} from "../../page-objects/application";
import type { inPageDriver } from "../../page-objects/infrastructure";
import type { ayme } from "../../page-objects/domain";

/**
 * The Page Object registry, as one lane builds it: the built package's in
 * Node, the source's in the browser. It runs unchanged over either.
 */
export type PageObjectsKit = {
  ayme: typeof ayme;
  createPomRegistry: typeof createPomRegistry;
  inPageDriver: typeof inPageDriver;
  registerCompiledPom: typeof registerCompiledPom;
};

/**
 * One runtime the in-page module's contract runs on: Playwright Lite in the
 * browser, or real Playwright in Node against the built package.
 */
export type { PageObjectConstructor };
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
  /** The Page Object registry this lane runs over the module. */
  pageObjects: PageObjectsKit;
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

/** The roots each host's `labelling` watch probes. */
const labellers = new WeakMap<
  InPage,
  { roots: readonly (readonly [label: string, selector: string])[] }
>();

/**
 * Runs one probe run of `inPageOf` that probes `roots`, each with its label,
 * so the host's later captures place them while its watch lasts.
 */
async function labelling(
  inPageOf: InPage,
  page: Page,
  roots: readonly (readonly [label: string, selector: string])[]
) {
  let labeller = labellers.get(inPageOf);
  if (!labeller) {
    const held = { roots };
    labeller = held;
    labellers.set(inPageOf, held);
    // The host's labels last as long as its watch does: it ends with the test.
    const stop = inPageOf.watch(async () => {
      await Promise.all(
        held.roots.map(([label, selector]) =>
          inPageOf.probe(page.locator(selector), label)
        )
      );
    });
    onTestFinished(stop);
  }
  labeller.roots = roots;
  inPageOf.refresh();
  await inPageOf.probed();
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

    await labelling(one.inPage(page), page, [["ListPage", "#a"]]);
    const first = await one.inPage(page).capture();
    await labelling(other.inPage(page), page, [["CartPage", "#b"]]);
    const second = await other.inPage(page).capture();
    await labelling(other.inPage(page), page, [
      ["CartPage", "#b"],
      ["ListPage", "#a"],
    ]);
    const both = await other.inPage(page).capture();

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
      '<button>Kept</button><aside id="ignored"><button>Ignored</button></aside><section id="absent" aria-label="Absent part" style="height:0"><button>Absent</button></section>'
    );
    const host = lane.createHost(page);
    await labelling(host.inPage(page), page, [["Absent", "#absent"]]);

    const capture = await host.inPage(page).capture({
      elements: await page.evaluateHandle<ElementInputs>(
        '({ ignores: [{ selector: "#ignored" }] })'
      ),
    });

    expect(capture.excludedRefs).toEqual([
      refOf(capture.fullText, "complementary"),
      refOf(capture.fullText, '"Ignored"'),
      refOf(capture.fullText, 'region "Absent part"'),
      refOf(capture.fullText, '"Absent"'),
    ]);
  });

  describe("the excluded-subtree mark", () => {
    const marked =
      '<button>Kept</button><aside id="panel" data-ayme-exclude><button>Panel</button></aside>';

    it("a capture leaves out the refs under a subtree that carries the mark, whoever captures", async () => {
      const page = await lane.newPage();
      await setBody(page, marked);
      const host = lane.createHost(page);

      const capture = await host.inPage(page).capture();

      expect(capture.excludedRefs).toEqual([
        refOf(capture.fullText, "complementary"),
        refOf(capture.fullText, '"Panel"'),
      ]);
    });

    it("reach sees through a marked subtree that covers an element, and leaves the page as it was", async () => {
      const page = await lane.newPage();
      await setBody(
        page,
        `<button>Save</button><div data-ayme-exclude style="position:fixed;inset:0"><style>[data-ayme-hit-test-through], [data-ayme-hit-test-through] * { pointer-events: none !important }</style></div>`
      );
      const inPageOf = lane.createHost(page).inPage(page);
      const { fullText } = await inPageOf.capture();

      expect(await inPageOf.measureReach(refOf(fullText, '"Save"'))).toEqual({
        present: true,
        available: true,
      });
      expect(
        await page.evaluate(
          'document.querySelector("[data-ayme-exclude]").hasAttribute("data-ayme-hit-test-through")'
        )
      ).toBe(false);
    });

    it("picking leaves a marked subtree alone, Esc cancels, then presses reach the page again", async () => {
      const page = await lane.newPage();
      await setBody(
        page,
        '<main><input aria-label="New item"><button>Add item</button></main><aside data-ayme-exclude><button>Panel</button></aside>'
      );
      await page.evaluate(`(() => {
        window.presses = [];
        for (const type of ["pointerdown", "mousedown", "mouseup", "click", "contextmenu"])
          document.addEventListener(type, (event) => window.presses.push(type + ":" + event.target.textContent));
      })()`);
      const inPageOf = lane.createHost(page).inPage(page);
      const { fullText } = await inPageOf.capture();

      const picked = inPageOf.pick([refOf(fullText, '"New item"')]);
      await page.getByRole("button", { name: "Panel" }).click();
      expect(await page.evaluate("window.presses")).toContain("click:Panel");
      await page.keyboard.press("Escape");

      expect(await picked).toBeUndefined();
      await page.getByRole("button", { name: "Add item" }).click();
      expect(await page.evaluate("window.presses")).toContain("click:Add item");
    });

    it("says whether the document has a marked subtree, and whether one covers an element's action point", async () => {
      const page = await lane.newPage();
      await setBody(page, "<button>Under</button><button>Free</button>");
      const inPageOf = lane.createHost(page).inPage(page);

      expect(await inPageOf.hasExcludedSubtree()).toBe(false);

      await page.evaluate(`(() => {
        const cover = document.createElement("div");
        cover.setAttribute("data-ayme-exclude", "");
        cover.style.cssText = "position:fixed;left:0;top:0;width:100%;height:20px";
        document.body.append(cover);
        const buttons = document.querySelectorAll("button");
        buttons[0].style.cssText = "position:fixed;left:0;top:0";
        buttons[1].style.cssText = "position:fixed;left:0;top:100px";
      })()`);

      expect(await inPageOf.hasExcludedSubtree()).toBe(true);
      expect(await inPageOf.coveredByExcluded(page.getByText("Under"))).toBe(
        true
      );
      expect(await inPageOf.coveredByExcluded(page.getByText("Free"))).toBe(
        false
      );
    });

    it("lets pointer events through marked subtrees while asked to, then marks nothing", async () => {
      const page = await lane.newPage();
      await setBody(page, '<aside id="one" data-ayme-exclude></aside>');
      const inPageOf = lane.createHost(page).inPage(page);
      const through = () =>
        page.evaluate(
          'document.querySelector("#one").hasAttribute("data-ayme-hit-test-through")'
        );

      await inPageOf.passThroughExcluded(true);
      expect(await through()).toBe(true);
      await inPageOf.passThroughExcluded(false);
      expect(await through()).toBe(false);
    });
  });

  it("the elements a Locator matched exclude what a selector does, in the captures of the host that handed them", async () => {
    const page = await lane.newPage();
    await setBody(
      page,
      '<button>Kept</button><aside id="ignored" aria-label="Assistant"><button>Ignored</button></aside>'
    );
    const [host, other] = [lane.createHost(page), lane.createHost(page)];
    const byMatches = () =>
      page.evaluateHandle<ElementInputs>(
        '({ ignores: [{ matches: "ignore" }] })'
      );

    const bySelector = await host.inPage(page).capture({
      elements: await page.evaluateHandle<ElementInputs>(
        '({ ignores: [{ selector: "#ignored" }] })'
      ),
    });
    await host
      .inPage(page)
      .match(page.getByRole("complementary", { name: "Assistant" }), "ignore");
    const byLocator = await host
      .inPage(page)
      .capture({ elements: await byMatches() });
    const byAnotherHost = await other
      .inPage(page)
      .capture({ elements: await byMatches() });

    expect(byLocator.excludedRefs).toEqual(bySelector.excludedRefs);
    expect(bySelector.excludedRefs).toHaveLength(2);
    expect(byAnotherHost.excludedRefs).toEqual([]);
  });

  it("a later match of a key replaces the elements the one before handed, so an element added between them is left out from the capture after the later one", async () => {
    const page = await lane.newPage();
    await setBody(
      page,
      '<aside aria-label="Panel"><button>First</button></aside>'
    );
    const inPageOf = lane.createHost(page).inPage(page);
    const panels = page.getByRole("complementary", { name: "Panel" });
    const capture = async () =>
      inPageOf.capture({
        elements: await page.evaluateHandle<ElementInputs>(
          '({ ignores: [{ matches: "ignore" }] })'
        ),
      });

    await inPageOf.match(panels, "ignore");
    await page.evaluate(
      `document.body.insertAdjacentHTML("beforeend", '<aside aria-label="Panel"><button>Second</button></aside>')`
    );
    const before = await capture();
    await inPageOf.match(panels, "ignore");
    const after = await capture();

    expect(before.excludedRefs).toContain(refOf(before.fullText, '"First"'));
    expect(before.excludedRefs).not.toContain(
      refOf(before.fullText, '"Second"')
    );
    expect(after.excludedRefs).toContain(refOf(after.fullText, '"Second"'));
  });

  it("a key a host forgets keeps nothing in its captures, while its other keys and another host's same key keep their matches", async () => {
    const page = await lane.newPage();
    await setBody(
      page,
      '<aside aria-label="Panel"><button>Ignored</button></aside><button>Kept</button>'
    );
    const [host, other] = [lane.createHost(page), lane.createHost(page)];
    const panel = page.getByRole("complementary", { name: "Panel" });
    const excluded = async (of: InPageHost, key: string) =>
      (
        await of.inPage(page).capture({
          elements: await page.evaluateHandle<ElementInputs>(
            `({ ignores: [{ matches: ${JSON.stringify(key)} }] })`
          ),
        })
      ).excludedRefs;
    await host.inPage(page).match(panel, "ignore");
    await host.inPage(page).match(panel, "other");
    await other.inPage(page).match(panel, "ignore");

    await host.inPage(page).forget(["ignore"]);

    expect(await excluded(host, "ignore")).toEqual([]);
    expect(await excluded(host, "other")).toHaveLength(2);
    expect(await excluded(other, "ignore")).toHaveLength(2);
  });

  it("a Custom Tool's filter carries the refs of the elements its Locator matched under the tool's name, as a selector's", async () => {
    const page = await lane.newPage();
    await setBody(
      page,
      "<button>One</button><button data-x>Two</button><p data-x>Not captured on its own</p>"
    );
    const inPageOf = lane.createHost(page).inPage(page);

    await inPageOf.match(page.getByRole("button", { name: "Two" }), "reveal");
    const capture = await inPageOf.capture({
      filters: [
        { name: "byLocator", filter: { matches: "reveal" } },
        { name: "bySelector", filter: { selector: "button[data-x]" } },
        { name: "unmatched", filter: { matches: "never handed" } },
      ],
    });

    const two = refOf(capture.fullText, '"Two"');
    expect(capture.accepted).toEqual({
      "tool:byLocator": [two],
      "tool:bySelector": [two],
      "tool:unmatched": [],
    });
  });

  it("checks a selector as a registration does: one that does not parse is a bad selector", async () => {
    const page = await lane.newPage();
    await setBody(page, "<button>Kept</button>");
    const host = lane.createHost(page);

    expect(await host.inPage(page).checkFilter({ selector: "#ok" })).toEqual({
      kind: "ok",
    });
    expect(
      await host.inPage(page).checkFilter({ selector: "[[not a selector" })
    ).toMatchObject({ kind: "bad-selector" });
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

    it("picks a Page Object Root that has no node of its own by its synthetic ref", async () => {
      const page = await lane.newPage();
      await setBody(
        page,
        '<div role="none" id="a" style="padding: 20px"><button>Inside</button></div><button>Other</button>'
      );
      const host = lane.createHost(page);
      const inPage = host.inPage(page);
      await labelling(inPage, page, [["ListPage", "#a"]]);
      const { roots } = await inPage.capture();
      const [root] = roots;
      if (!root || !("syntheticRef" in root))
        throw new Error("The root is synthetic.");

      const picked = inPage.pick([root.syntheticRef]);
      // The padding is the root's own pixels; the button inside has a ref of its own.
      await page.locator("#a").click({ position: { x: 5, y: 5 } });

      expect(await picked).toBe(root.syntheticRef);
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

    it("a pick that starts while another waits ends the earlier one, as Esc does, and the later one alone takes the click", async () => {
      const { page, inPage, refs } = await picking();
      const picks = () =>
        page.evaluate(
          "document.querySelectorAll('style[data-ayme-picking]').length"
        );
      const first = inPage.pick([refs.input]);
      let firstEnded = false;
      void first.then(() => (firstEnded = true));
      await expect.poll(picks).toBe(1);

      const second = inPage.pick([refs.button]);

      await expect.poll(() => firstEnded).toBe(true);
      expect(await first).toBeUndefined();
      expect(await picks()).toBe(1);
      await page.getByRole("button", { name: "Add item" }).click();
      expect(await second).toBe(refs.button);
      expect(await page.evaluate("window.presses")).toEqual([]);
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

  describe("probing a Page Object Root", () => {
    it("a root that shows and nothing covers is one element, present and available, named by its ref", async () => {
      const page = await lane.newPage();
      await setBody(page, '<main><button id="save">Save</button></main>');
      const inPageOf = lane.createHost(page).inPage(page);

      const state = await inPageOf.probe(page.locator("#save"), "SavePage");

      expect(state).toEqual({
        count: 1,
        present: true,
        available: true,
        ref: expect.any(String),
        inTheWay: [],
      });
      expect(
        await page.locator(`ayme-ref=${state.ref}`).getAttribute("id")
      ).toBe("save");
    });

    it("a Locator that matches nothing, or several elements, has no root", async () => {
      const page = await lane.newPage();
      await setBody(page, "<p>Row</p><p>Row</p>");
      const inPageOf = lane.createHost(page).inPage(page);

      expect(await inPageOf.probe(page.locator("#none"), "A")).toEqual({
        count: 0,
        present: false,
        available: false,
        inTheWay: [],
      });
      expect(await inPageOf.probe(page.locator("p"), "A")).toEqual({
        count: 2,
        present: false,
        available: false,
        inTheWay: [],
      });
    });

    it("a root that does not show is absent, and still named by its ref", async () => {
      const page = await lane.newPage();
      await setBody(page, '<p id="hidden" style="display:none">Hidden</p>');
      const inPageOf = lane.createHost(page).inPage(page);

      const state = await inPageOf.probe(page.locator("#hidden"), "A");

      expect(state).toMatchObject({
        count: 1,
        present: false,
        available: false,
        inTheWay: [],
      });
      expect(
        await page.locator(`ayme-ref=${state.ref}`).getAttribute("id")
      ).toBe("hidden");
    });

    it("a root a click would not reach is present and unavailable, and names what is in the way", async () => {
      const page = await lane.newPage();
      await setBody(
        page,
        '<button id="save">Save</button><div id="cover" role="dialog" aria-label="Cover" style="position:fixed;inset:0"></div>'
      );
      const inPageOf = lane.createHost(page).inPage(page);

      const state = await inPageOf.probe(page.locator("#save"), "SavePage");

      expect(state).toMatchObject({ present: true, available: false });
      expect(state.inTheWay).toHaveLength(1);
      expect(
        await page.locator(`ayme-ref=${state.inTheWay[0]}`).getAttribute("id")
      ).toBe("cover");
    });

    it("probing installs the module in a document that has none, and measures nothing it scrolls", async () => {
      const page = await lane.newPage();
      await setBody(
        page,
        '<div style="height:3000px"></div><button id="far">Far</button>'
      );
      const inPageOf = lane.createHost(page).inPage(page);

      const state = await inPageOf.probe(page.locator("#far"), "FarPage");

      expect(state).toMatchObject({ count: 1, present: true, available: true });
      expect(await page.evaluate("window.scrollY")).toBe(0);
    });

    it("a probe outside a probe run labels nothing in the captures", async () => {
      const page = await lane.newPage();
      await setBody(page, '<div role="none" id="a"><button>One</button></div>');
      const inPageOf = lane.createHost(page).inPage(page);

      await inPageOf.probe(page.locator("#a"), "ListPage");

      expect((await inPageOf.capture()).roots).toEqual([]);
    });

    it("a root a click would not reach is still marked, and a root that does not show is left out of the captures", async () => {
      const page = await lane.newPage();
      await setBody(
        page,
        '<div id="a" role="region" aria-label="Shown"><button>One</button></div><div id="b" role="region" aria-label="Hidden" style="height:0"><button>Two</button></div>'
      );
      const inPageOf = lane.createHost(page).inPage(page);

      await labelling(inPageOf, page, [
        ["ShownPage", "#a"],
        ["HiddenPage", "#b"],
      ]);
      const capture = await inPageOf.capture();

      expect(capture.roots).toEqual([
        { labels: ["ShownPage"], ref: refOf(capture.fullText, "Shown") },
      ]);
      expect(capture.excludedRefs).toEqual([
        refOf(capture.fullText, "Hidden"),
        refOf(capture.fullText, '"Two"'),
      ]);
    });

    it("the labels are the ones of the latest completed run, and a run that probes no root clears them", async () => {
      const page = await lane.newPage();
      await setBody(page, '<div role="none" id="a"><button>One</button></div>');
      const inPageOf = lane.createHost(page).inPage(page);
      await labelling(inPageOf, page, [["ListPage", "#a"]]);
      expect((await inPageOf.capture()).roots).toHaveLength(1);

      await labelling(inPageOf, page, []);

      expect((await inPageOf.capture()).roots).toEqual([]);
    });

    it("a root the capture marked after a probe named it keeps the ref the probe gave", async () => {
      const page = await lane.newPage();
      await setBody(page, '<button id="save">Save</button>');
      const inPageOf = lane.createHost(page).inPage(page);
      const { ref } = await inPageOf.probe(page.locator("#save"), "SavePage");

      await inPageOf.capture();

      expect(await page.locator(`ayme-ref=${ref}`).getAttribute("id")).toBe(
        "save"
      );
    });

    it("mint names the elements a Locator matches, and the same element by the same ref", async () => {
      const page = await lane.newPage();
      await setBody(page, "<p>One</p><p>Two</p>");
      const inPageOf = lane.createHost(page).inPage(page);

      const refs = await inPageOf.mint(page.locator("p"));
      const again = await inPageOf.mint(page.locator("p").last());

      expect(refs).toHaveLength(2);
      expect(again).toEqual([refs[1]]);
      expect(await inPageOf.mint(page.locator("#none"))).toEqual([]);
    });

    it("currentRefs() names each ref's element by the ref it has now: the capture's mark after a probe named it first, and nothing for an element that left", async () => {
      const page = await lane.newPage();
      await setBody(
        page,
        '<button id="b">Save</button><div id="plain">x</div>'
      );
      const inPageOf = lane.createHost(page).inPage(page);
      // Named before any capture marked it: a synthetic ref.
      const [first] = await inPageOf.mint(page.locator("#b"));
      const [plain] = await inPageOf.mint(page.locator("#plain"));
      const { fullText, renamed } = await inPageOf.capture();
      const marked = refOf(fullText, '"Save"');

      expect(marked).not.toBe(first);
      // The capture says which mark replaced the ref the probe gave.
      expect(renamed).toMatchObject({ [first!]: marked });
      const now = await inPageOf.currentRefs([first!, marked, plain!, "e999"]);
      // The capture marked the other element too: its mark replaces the probe's.
      expect(now).toEqual([
        marked,
        marked,
        expect.stringMatching(/^e\d+$/),
        undefined,
      ]);
      expect(now[2]).not.toBe(plain);

      await page.evaluate('document.querySelector("#b").remove()');
      expect(await inPageOf.currentRefs([first!, plain!])).toEqual([
        undefined,
        now[2],
      ]);
    });
  });

  describe("element keys", () => {
    it("elementKeys() gives an element a key it keeps however often a capture renames it, and keyedRefs() answers the ref it has now, and nothing once it left", async () => {
      const page = await lane.newPage();
      await setBody(page, '<button id="b" aria-label="Name">x</button>');
      const inPageOf = lane.createHost(page).inPage(page);
      const [first] = await inPageOf.mint(page.locator("#b"));
      const [keyed] = await inPageOf.elementKeys([first!]);
      expect(keyed).toEqual({ key: expect.any(String), ref: first });

      // More renames than the refs an element keeps.
      let ref = first!;
      for (let count = 0; count < 20; count += 1) {
        await page.evaluate(
          `document.querySelector("#b").setAttribute("aria-label", "Name ${count}")`
        );
        ref = refOf((await inPageOf.capture()).fullText, `"Name ${count}"`);
      }

      expect(await inPageOf.keyedRefs([keyed!.key])).toEqual([ref]);
      expect(await inPageOf.elementKeys([ref, "e999"])).toEqual([
        { key: keyed!.key, ref },
        undefined,
      ]);
      // The key is no ref: no capture prints it, and it acts on nothing.
      expect((await inPageOf.capture()).fullText).not.toContain(keyed!.key);

      await page.evaluate('document.querySelector("#b").remove()');
      expect(await inPageOf.keyedRefs([keyed!.key])).toEqual([undefined]);
      expect(await inPageOf.elementKeys([ref])).toEqual([undefined]);
    });

    it("two hosts on one document get one key for one element, and another element another", async () => {
      const page = await lane.newPage();
      await setBody(page, "<p>One</p><p>Two</p>");
      const [one, other] = [lane.createHost(page), lane.createHost(page)];
      const refs = await one.inPage(page).mint(page.locator("p"));

      const keys = await one.inPage(page).elementKeys(refs);

      expect(await other.inPage(page).elementKeys(refs)).toEqual(keys);
      expect(keys[0]!.key).not.toBe(keys[1]!.key);
      expect(
        await other.inPage(page).keyedRefs(keys.map((keyed) => keyed!.key))
      ).toEqual(refs);
    });

    it.runIf(lane.hostsOutliveLoads)(
      "a key names no element of the next document, though that document gives its element the same ref",
      async () => {
        const page = await lane.newPage();
        await setBody(page, '<button id="b">Save</button>');
        const inPageOf = lane.createHost(page).inPage(page);
        const [ref] = await inPageOf.mint(page.locator("#b"));
        const [keyed] = await inPageOf.elementKeys([ref!]);

        const next = await lane.reload(page);
        await setBody(next, '<button id="b">Save</button>');
        const [again] = await inPageOf.mint(next.locator("#b"));

        expect(again).toBe(ref);
        expect(await inPageOf.keyedRefs([keyed!.key])).toEqual([undefined]);
        expect((await inPageOf.elementKeys([again!]))[0]!.key).not.toBe(
          keyed!.key
        );
      }
    );
  });

  describe("watching the page", () => {
    it("names the element it matched by a ref it gave before, though the ref has changed since", async () => {
      const page = await lane.newPage();
      await setBody(page, '<button id="save">Save</button><p id="other">x</p>');
      const inPageOf = lane.createHost(page).inPage(page);
      const { ref } = await inPageOf.probe(page.locator("#save"), "SavePage");
      // A capture marks the button, which then has a ref of its own.
      const { fullText } = await inPageOf.capture();

      expect(refOf(fullText, '"Save"')).not.toBe(ref);
      expect(await inPageOf.names(page.locator("#save"), ref!)).toBe(true);
      expect(await inPageOf.names(page.locator("#other"), ref!)).toBe(false);
      expect(await inPageOf.names(page.locator("button, p"), ref!)).toBe(false);
    });

    it("refresh makes a probe run due for a change the page did not make", async () => {
      const page = await lane.newPage();
      await setBody(page, "<p>One</p>");
      const inPageOf = lane.createHost(page).inPage(page);
      const log: string[] = [];
      const stop = inPageOf.watch(async () => {
        log.push("run");
      });
      await inPageOf.probed();
      expect(log).toEqual(["run"]);

      inPageOf.refresh();
      await inPageOf.probed();

      expect(log).toEqual(["run", "run"]);
      stop();
      inPageOf.refresh();
      await inPageOf.probed();
      expect(log).toEqual(["run", "run"]);
    });

    /** A watch whose runs a test records, each as the instants it began and ended. */
    function recorder(
      inPageOf: InPage,
      during: () => Promise<void> = async () => {}
    ) {
      const log: string[] = [];
      let running = 0;
      let overlapped = false;
      const stop = inPageOf.watch(async () => {
        running += 1;
        overlapped ||= running > 1;
        log.push("begin");
        await during();
        log.push("end");
        running -= 1;
      });
      return { log, stop, overlapped: () => overlapped };
    }

    it("probes now, and again after the page changes", async () => {
      const page = await lane.newPage();
      await setBody(page, "<p>One</p>");
      const inPageOf = lane.createHost(page).inPage(page);
      const { log, stop } = recorder(inPageOf);

      await inPageOf.probed();
      expect(log).toEqual(["begin", "end"]);
      await setBody(page, "<p>Two</p>");
      await expect.poll(() => log.length).toBe(4);
      await inPageOf.probed();

      expect(log).toEqual(["begin", "end", "begin", "end"]);
      stop();
    });

    it("follows layout and scroll as well as the DOM", async () => {
      const page = await lane.newPage();
      await setBody(page, '<div style="height:3000px"></div>');
      const inPageOf = lane.createHost(page).inPage(page);
      const { log, stop } = recorder(inPageOf);
      await inPageOf.probed();

      await page.evaluate("window.scrollTo(0, 500)");

      await expect.poll(() => log.length).toBe(4);
      stop();
    });

    it("runs one at a time, and the changes made during a run are one follow-up", async () => {
      const page = await lane.newPage();
      await setBody(page, "<p>One</p>");
      const inPageOf = lane.createHost(page).inPage(page);
      let release = () => {};
      let gate = new Promise<void>((resolve) => (release = resolve));
      const { log, stop, overlapped } = recorder(inPageOf, () => gate);
      await expect.poll(() => log.length).toBe(1);

      for (const text of ["Two", "Three", "Four"]) {
        await setBody(page, `<p>${text}</p>`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      gate = Promise.resolve();
      release();
      await expect.poll(() => log.length).toBe(4);
      await inPageOf.probed();

      expect(log).toEqual(["begin", "end", "begin", "end"]);
      expect(overlapped()).toBe(false);
      stop();
    });

    it("probed settles a change made in the same task, awaiting at most one follow-up", async () => {
      const page = await lane.newPage();
      await setBody(page, "<p>One</p>");
      const inPageOf = lane.createHost(page).inPage(page);
      const { log, stop } = recorder(inPageOf);
      await inPageOf.probed();
      log.length = 0;

      await setBody(page, "<p>Two</p>");
      await inPageOf.probed();

      expect(log).toEqual(["begin", "end"]);
      stop();
    });

    it("probed resolves at once when nothing watches, and rejects with what a run failed with", async () => {
      const page = await lane.newPage();
      const inPageOf = lane.createHost(page).inPage(page);
      await inPageOf.probed();

      const stop = inPageOf.watch(async () => {
        throw new Error("unreadable");
      });

      await expect(inPageOf.probed()).rejects.toThrow("unreadable");
      stop();
    });

    it("a second watch of one Page throws, and a watch can start again once stopped", async () => {
      const page = await lane.newPage();
      const inPageOf = lane.createHost(page).inPage(page);
      const stop = inPageOf.watch(async () => {});

      expect(() => inPageOf.watch(async () => {})).toThrow(/watched already/);
      stop();
      const again = inPageOf.watch(async () => {});
      again();
    });

    it("stops: the signal aborts and no run begins after", async () => {
      const page = await lane.newPage();
      await setBody(page, "<p>One</p>");
      const inPageOf = lane.createHost(page).inPage(page);
      let signal: AbortSignal | undefined;
      const log: string[] = [];
      const stop = inPageOf.watch(async (given) => {
        signal = given;
        log.push("run");
      });
      await inPageOf.probed();

      stop();
      await setBody(page, "<p>Two</p>");
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(signal?.aborted).toBe(true);
      expect(log).toEqual(["run"]);
    });

    it.runIf(lane.hostsOutliveLoads)(
      "follows the page across a full load, probing the next document",
      async () => {
        const page = await lane.newPage();
        const inPageOf = lane.createHost(page).inPage(page);
        const documents: string[] = [];
        const stop = inPageOf.watch(async () => {
          documents.push((await inPageOf.bound()).document);
        });
        await inPageOf.probed();

        await lane.reload(page);
        await expect.poll(() => documents.length).toBe(2);

        expect(documents[1]).not.toBe(documents[0]);
        stop();
      }
    );

    it.runIf(lane.hostsOutliveLoads)(
      "a load during a probe run arms watching the next document, which then follows its changes",
      async () => {
        const page = await lane.newPage();
        const inPageOf = lane.createHost(page).inPage(page);
        let runs = 0;
        let next: Page | undefined;
        const stop = inPageOf.watch(async () => {
          runs += 1;
          // The first run is still going when the next document loads.
          if (runs === 1) next = await lane.reload(page);
        });
        // A longer wait than the default: the reload is slow on a loaded machine.
        await expect.poll(() => runs, { timeout: 10_000 }).toBe(2);

        await setBody(next!, "<p>Changed in the next document</p>");

        await expect.poll(() => runs, { timeout: 10_000 }).toBe(3);
        stop();
      }
    );
  });

  describe("Page Objects registered against the page", () => {
    const toolName = "SettingsPage.open";
    const settingsManifest = {
      className: "SettingsPage",
      members: [{ memberName: "root", kind: "locator", access: "field" }],
      tools: [
        {
          methodName: "open",
          toolName,
          description: "Open the settings",
          parameters: [],
        },
      ],
      components: [],
    } as const;

    /** A registry over `page`'s module holding a Page Object rooted at `#settings`. */
    function registerSettingsPage(page: Page) {
      const { ayme, createPomRegistry, inPageDriver, registerCompiledPom } =
        lane.pageObjects;
      const inPageOf = lane.createHost(page).inPage(page);
      const registry = createPomRegistry(
        inPageDriver(
          () => inPageOf,
          () => undefined
        )
      );
      class SettingsPage {
        readonly root = page.locator("#settings");
        open() {}
      }
      ayme({ root: (self: SettingsPage) => self.root })(SettingsPage);
      registerCompiledPom(SettingsPage, settingsManifest);
      const registration = registry.registerPageObject(
        SettingsPage,
        new SettingsPage()
      );
      const listed = () =>
        registry
          .listRegisteredPomTools()
          .map(({ tool, present, available }) => [
            tool.name,
            present,
            available,
          ]);
      const available = () =>
        registry.listAvailablePomTools().map((tool) => tool.name);
      return {
        inPageOf,
        registry,
        listed,
        available,
        dispose: () => {
          registration.dispose();
          registry.resetRegisteredPoms();
        },
      };
    }

    it("lists the tool only while its root is present and available, and follows the page as it changes", async () => {
      const page = await lane.newPage();
      const { listed, available, dispose } = registerSettingsPage(page);

      // No root on the page yet: listed, but neither present nor available.
      await expect.poll(listed).toEqual([[toolName, false, false]]);
      expect(available()).toEqual([]);

      await setBody(page, '<section id="settings">Settings</section>');
      await expect.poll(available).toEqual([toolName]);
      expect(listed()).toEqual([[toolName, true, true]]);

      // An overlay now covers the root: present, but a click would not reach it.
      await page.evaluate(
        `document.body.insertAdjacentHTML("beforeend", '<div id="cover" style="position:fixed;inset:0"></div>')`
      );
      await expect.poll(listed).toEqual([[toolName, true, false]]);
      expect(available()).toEqual([]);

      await page.evaluate(`document.getElementById("cover").remove()`);
      await expect.poll(available).toEqual([toolName]);

      await page.evaluate(
        `document.getElementById("settings").style.display = "none"`
      );
      await expect.poll(listed).toEqual([[toolName, false, false]]);
      expect(available()).toEqual([]);
      dispose();
    });

    it("keeps the registries of two pages apart", async () => {
      const first = await lane.newPage();
      const second = await lane.newPage();
      await setBody(first, '<section id="settings">Settings</section>');
      await setBody(second, '<section id="settings">Settings</section>');
      const registeredOnFirst = registerSettingsPage(first);
      const registeredOnSecond = registerSettingsPage(second);

      await expect.poll(registeredOnFirst.available).toEqual([toolName]);
      await expect.poll(registeredOnSecond.available).toEqual([toolName]);
      // Hiding the root on the first page changes nothing on the second.
      await first.evaluate(
        `document.getElementById("settings").style.display = "none"`
      );
      await expect.poll(registeredOnFirst.available).toEqual([]);
      expect(registeredOnSecond.available()).toEqual([toolName]);
      // Each page's module marks the roots of its own registry alone.
      await registeredOnFirst.registry.probeRegisteredPomMembers();
      await registeredOnSecond.registry.probeRegisteredPomMembers();
      expect((await registeredOnFirst.inPageOf.capture()).roots).toEqual([]);
      expect(
        (await registeredOnSecond.inPageOf.capture()).roots.map(
          ({ labels }) => labels
        )
      ).toEqual([["SettingsPage"]]);
      registeredOnFirst.dispose();
      registeredOnSecond.dispose();
    });

    it("tells its subscribers when the tools change, and marks the root in the host's captures while it is present", async () => {
      const page = await lane.newPage();
      await setBody(
        page,
        '<section id="settings" aria-label="Settings"><button>Save</button></section>'
      );
      const { inPageOf, registry, available, dispose } =
        registerSettingsPage(page);
      let heard = 0;
      registry.subscribeToRegisteredPoms(() => (heard += 1));

      await expect.poll(available).toEqual([toolName]);
      await registry.probeRegisteredPomMembers();
      const marked = await inPageOf.capture();
      expect(heard).toBeGreaterThan(0);
      expect(marked.roots).toEqual([
        { labels: ["SettingsPage"], ref: refOf(marked.fullText, "Settings") },
      ]);

      await page.evaluate(
        `document.getElementById("settings").style.display = "none"`
      );
      await expect.poll(available).toEqual([]);
      await registry.probeRegisteredPomMembers();
      expect((await inPageOf.capture()).roots).toEqual([]);
      dispose();
    });

    /** The ids of the Page Objects the registry reads on the page now. */
    const idsOn = async (registry: ReturnType<typeof createPomRegistry>) =>
      (await registry.readPageObjectTree()).map(({ id }) => id);

    it("keeps a root's id however often its name changes between two reads", async () => {
      const page = await lane.newPage();
      await setBody(
        page,
        '<section id="settings" aria-label="Settings">S</section>'
      );
      // Captured before any probe: the root is named by a capture's mark,
      // which a later rename retires, not by a synthetic ref.
      await lane.createHost(page).inPage(page).capture();
      const { inPageOf, registry, available, dispose } =
        registerSettingsPage(page);
      await expect.poll(available).toEqual([toolName]);
      expect(await idsOn(registry)).toEqual(["po1"]);

      // More renames than the refs an element keeps, with no read between.
      for (let count = 0; count < 20; count += 1) {
        await page.evaluate(
          `document.querySelector("#settings").setAttribute("aria-label", "Settings ${count}")`
        );
        await inPageOf.capture();
      }

      expect(await idsOn(registry)).toEqual(["po1"]);
      dispose();
    });

    it("never gives the id of a root that left to the element that replaces it", async () => {
      const page = await lane.newPage();
      await setBody(page, '<section id="settings">S</section>');
      const { registry, available, listed, dispose } =
        registerSettingsPage(page);
      await expect.poll(available).toEqual([toolName]);
      expect(await idsOn(registry)).toEqual(["po1"]);

      await setBody(page, "");
      await expect.poll(listed).toEqual([[toolName, false, false]]);
      expect(await idsOn(registry)).toEqual([]);
      await setBody(page, '<section id="settings">S</section>');
      await expect.poll(available).toEqual([toolName]);

      expect(await idsOn(registry)).toEqual(["po2"]);
      dispose();
    });

    it.runIf(lane.hostsOutliveLoads)(
      "gives the root of the next document an id of its own, though it has the ref the earlier root had",
      async () => {
        const page = await lane.newPage();
        await setBody(page, '<section id="settings">S</section>');
        const { registry, available, dispose } = registerSettingsPage(page);
        await expect.poll(available).toEqual([toolName]);
        expect(await idsOn(registry)).toEqual(["po1"]);

        const next = await lane.reload(page);
        await setBody(next, '<section id="settings">S</section>');
        await expect.poll(available).toEqual([toolName]);

        expect(await idsOn(registry)).toEqual(["po2"]);
        dispose();
      }
    );

    it("unregistering the last Page Object takes its root labels off the surviving DOM", async () => {
      const page = await lane.newPage();
      await setBody(
        page,
        '<section id="settings" aria-label="Settings"><button>Save</button></section>'
      );
      const { inPageOf, registry, available, dispose } =
        registerSettingsPage(page);
      await expect.poll(available).toEqual([toolName]);
      await registry.probeRegisteredPomMembers();
      expect((await inPageOf.capture()).roots).toHaveLength(1);

      dispose();

      await expect
        .poll(async () => (await inPageOf.capture()).roots)
        .toEqual([]);
    });

    it("unregistering the last Page Object leaves an absent root's subtree in the captures once it shows", async () => {
      const page = await lane.newPage();
      await setBody(
        page,
        '<section id="settings" aria-label="Settings" style="display:none"><button>Save</button></section>'
      );
      const { inPageOf, registry, listed, dispose } =
        registerSettingsPage(page);
      await expect.poll(listed).toEqual([[toolName, false, false]]);
      await registry.probeRegisteredPomMembers();
      dispose();
      // Shown now, nothing registers it.
      await page.evaluate(
        `document.getElementById("settings").style.display = ""`
      );

      const shown = await inPageOf.capture();
      expect(shown.fullText).toContain("Save");
      await expect
        .poll(async () => (await inPageOf.capture()).excludedRefs)
        .toEqual([]);
    });
  });

  describe("predicates", () => {
    /** One element each, labelled by its text or aria-label, with the predicates that keep it. */
    const fixtures: [html: string, label: string, kept: Predicate[]][] = [
      ["<button>Save</button>", "Save", ["clickable"]],
      ['<a href="/next">Next</a>', "Next", ["clickable"]],
      ['<div role="button">Go</div>', "Go", ["clickable"]],
      ['<div style="cursor: pointer">Card</div>', "Card", ["clickable"]],
      ["<p>Just text</p>", "Just text", []],
      ["<button disabled>Locked</button>", "Locked", []],
      ['<button aria-disabled="true">Veiled</button>', "Veiled", []],
      ['<input aria-label="Name">', "Name", ["clickable", "fillable"]],
      [
        '<input type="email" aria-label="Mail">',
        "Mail",
        ["clickable", "fillable"],
      ],
      [
        '<textarea aria-label="Note"></textarea>',
        "Note",
        ["clickable", "fillable"],
      ],
      [
        '<div contenteditable="true" aria-label="Rich"></div>',
        "Rich",
        ["clickable", "fillable"],
      ],
      ['<input readonly aria-label="Fixed">', "Fixed", ["clickable"]],
      ['<input disabled aria-label="Off">', "Off", []],
      ['<input type="file" aria-label="Upload">', "Upload", ["clickable"]],
      [
        '<input type="checkbox" aria-label="Done">',
        "Done",
        ["clickable", "checkable", "uncheckable"],
      ],
      [
        '<input type="radio" aria-label="Pick">',
        "Pick",
        ["clickable", "checkable"],
      ],
      [
        '<div role="switch" aria-label="Power"></div>',
        "Power",
        ["clickable", "checkable", "uncheckable"],
      ],
      ['<input type="checkbox" disabled aria-label="Frozen">', "Frozen", []],
      [
        '<select aria-label="Size"><option>S</option></select>',
        "Size",
        ["clickable", "select"],
      ],
      [
        '<select disabled aria-label="Shut"><option>S</option></select>',
        "Shut",
        [],
      ],
      ['<div role="combobox" aria-label="Menu"></div>', "Menu", ["clickable"]],
    ];

    it("each predicate keeps exactly the refs of the elements it takes, in capture order", async () => {
      const page = await lane.newPage();
      await setBody(page, fixtures.map(([html]) => html).join(""));
      const inPageOf = lane.createHost(page).inPage(page);

      const { distilledText: text, accepted } = await inPageOf.capture({
        accepts: PREDICATES,
      });
      // A named node prints its name in quotes, any other its text after a colon.
      const refOfLabel = (label: string) =>
        text.includes(`"${label}"`)
          ? refOf(text, `"${label}"`)
          : refOf(text, `: ${label}`);

      for (const predicate of PREDICATES)
        expect(accepted?.[predicate], predicate).toEqual(
          fixtures
            .filter(([, , kept]) => kept.includes(predicate))
            .map(([, label]) => refOfLabel(label))
        );
    });

    it("a capture carries only the predicates it was asked for", async () => {
      const page = await lane.newPage();
      await setBody(page, "<button>Save</button>");
      const inPageOf = lane.createHost(page).inPage(page);

      const some = await inPageOf.capture({ accepts: ["clickable"] });
      const none = await inPageOf.capture();

      expect(Object.keys(some.accepted ?? {})).toEqual(["clickable"]);
      expect(none).not.toHaveProperty("accepted");
    });

    it("is() answers a predicate for the one element a Locator matches", async () => {
      const page = await lane.newPage();
      await setBody(
        page,
        '<button>Save</button><p>Text</p><input type="checkbox" aria-label="Done">'
      );
      const inPageOf = lane.createHost(page).inPage(page);

      expect(await inPageOf.is(page.getByRole("button"), "clickable")).toBe(
        true
      );
      expect(await inPageOf.is(page.getByText("Text"), "clickable")).toBe(
        false
      );
      expect(await inPageOf.is(page.getByLabel("Done"), "uncheckable")).toBe(
        true
      );
      expect(await inPageOf.is(page.getByLabel("Done"), "fillable")).toBe(
        false
      );
    });

    it("is() throws unless the Locator matches exactly one element", async () => {
      const page = await lane.newPage();
      await setBody(page, "<button>One</button><button>Two</button>");
      const inPageOf = lane.createHost(page).inPage(page);

      await expect(
        inPageOf.is(page.getByRole("button"), "clickable")
      ).rejects.toMatchObject({
        name: "RefResolutionError",
        message: "the locator matches 2 elements; it must match exactly one",
      });
      await expect(
        inPageOf.is(page.getByRole("heading"), "clickable")
      ).rejects.toMatchObject({
        name: "RefResolutionError",
        message: "the locator matches no element",
      });
    });

    it("reachable() keeps the refs a click or a focus would reach, in order", async () => {
      const page = await lane.newPage();
      await setBody(
        page,
        '<button>Free</button><dialog aria-label="Modal"><button>Inside</button></dialog>'
      );
      await page.evaluate(`document.querySelector("dialog").showModal()`);
      const inPageOf = lane.createHost(page).inPage(page);
      const { fullText } = await inPageOf.capture();
      const [free, inside] = [
        refOf(fullText, '"Free"'),
        refOf(fullText, '"Inside"'),
      ];

      expect(await inPageOf.reachable([free, inside], "click")).toEqual([
        inside,
      ]);
      expect(await inPageOf.reachable([inside, free], "focus")).toEqual([
        inside,
      ]);
      expect(await inPageOf.reachable(["e999"], "click")).toEqual([]);
      expect(await inPageOf.reachable([], "click")).toEqual([]);
    });

    it("mint() names each element a Locator matches, minting a ref for one no capture named", async () => {
      const page = await lane.newPage();
      await setBody(page, '<button>First</button><div id="plain">x</div>');
      const inPageOf = lane.createHost(page).inPage(page);
      const { fullText } = await inPageOf.capture();

      expect(await inPageOf.mint(page.getByRole("button"))).toEqual([
        refOf(fullText, '"First"'),
      ]);
      const [minted] = await inPageOf.mint(page.locator("#plain"));
      expect(await page.locator(`ayme-ref=${minted}`).getAttribute("id")).toBe(
        "plain"
      );
      expect(await inPageOf.mint(page.locator("#none"))).toEqual([]);
    });
  });

  describe("Locator Recommendation", () => {
    const orders = `
      <h1>Orders</h1>
      <ul>
        <li id="row-1" aria-label="Order 1"><span>Order 1</span><button>Delete</button></li>
        <li id="row-2" aria-label="Order 2"><span>Order 2</span><button>Delete</button></li>
      </ul>
      <button id="settings" aria-label="Settings"><span id="icon">⚙</span></button>
      <button data-testid="submit-order">Submit</button>
      <button class="twin">Twin</button><button class="twin">Twin</button>`;

    async function ordersPage() {
      const page = await lane.newPage();
      await setBody(page, orders);
      return { page, inPageOf: lane.createHost(page).inPage(page) };
    }

    it("recommends the page-level locator Playwright's generator writes for one element", async () => {
      const { page, inPageOf } = await ordersPage();

      expect(await inPageOf.recommend(page.getByRole("heading"))).toBe(
        "getByRole('heading', { name: 'Orders' })"
      );
      expect(await inPageOf.recommend(page.locator("#settings"))).toBe(
        "getByRole('button', { name: 'Settings' })"
      );
      expect(await inPageOf.recommend(page.locator("#icon"))).toBe(
        "getByRole('button', { name: 'Settings' })"
      );
      expect(await inPageOf.recommend(page.getByText("Submit"))).toBe(
        "getByTestId('submit-order')"
      );
    });

    it("recommends relative to a container, the same element reached by its own row", async () => {
      const { page, inPageOf } = await ordersPage();

      const inRow = await inPageOf.recommend(
        page.locator("#row-2 button"),
        page.locator("#row-2")
      );
      const inPage = await inPageOf.recommend(
        page.locator("#row-2 button"),
        undefined
      );

      expect(inRow).toBe("getByRole('button', { name: 'Delete' })");
      expect(inPage).not.toBe(inRow);
    });

    it("a container the page replaces while it is being resolved gives way to the container now on the page", async () => {
      const { page, inPageOf } = await ordersPage();
      const row = page.locator("#row-2");
      let replaced = false;
      // The first time the container is resolved, the page renders it again
      // before the target is read; the host holds the old element.
      const rendering = {
        elementHandle: async () => {
          const handle = await row.elementHandle();
          if (!replaced) {
            replaced = true;
            await page.evaluate(
              `(() => { const row = document.getElementById("row-2"); row.replaceWith(row.cloneNode(true)); })()`
            );
          }
          return handle;
        },
      } as unknown as Locator;

      const recommended = await inPageOf.recommend(
        page.locator("#row-2 button"),
        rendering
      );

      expect(replaced).toBe(true);
      expect(recommended).toBe("getByRole('button', { name: 'Delete' })");
    });

    it("a locator relative to its container finds exactly the element from the container", async () => {
      const { page, inPageOf } = await ordersPage();
      const container = page.locator("#row-2");

      const recommended = await inPageOf.recommend(
        page.locator("#row-2 button"),
        container
      );

      const found = new Function("scope", `return scope.${recommended};`)(
        container
      );
      expect(await found.count()).toBe(1);
      expect(
        await found.evaluate((element: Element) => element.closest("li")?.id)
      ).toBe("row-2");
    });

    it("tells twins apart by position", async () => {
      const { page, inPageOf } = await ordersPage();

      expect(await inPageOf.recommend(page.locator(".twin").first())).toBe(
        "getByRole('button', { name: 'Twin' }).first()"
      );
      expect(await inPageOf.recommend(page.locator(".twin").last())).toBe(
        "getByRole('button', { name: 'Twin' }).nth(1)"
      );
    });

    it("throws a RefResolutionError unless the target and the container each match exactly one element", async () => {
      const { page, inPageOf } = await ordersPage();

      await expect(
        inPageOf.recommend(page.locator("li"))
      ).rejects.toMatchObject({
        name: "RefResolutionError",
      });
      await expect(
        inPageOf.recommend(page.locator("#row-1 button"), page.locator("li"))
      ).rejects.toThrow(/strict mode violation|matches 2 elements/);
    });
  });
}
