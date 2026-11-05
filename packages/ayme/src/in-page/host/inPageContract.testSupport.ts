import type { Page } from "@playwright/test";
import { expect, it } from "vitest";

import type { ElementInputs, InPageHost } from "./inPage";

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
  /** Whether a host outlives a full load of its page, as a Node host does and the page's own runtime does not. */
  hostsOutliveLoads: boolean;
};

/** Replaces the page's body, in the page's own realm on either runtime. */
async function setBody(page: Page, html: string) {
  await page.evaluate(`document.body.innerHTML = ${JSON.stringify(html)}`);
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
  });

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
}
