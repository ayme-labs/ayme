// Question 3: what the gate breaks. Each case runs with no gate (mode
// `before`), with variant A and with variant B, on a fresh load of /edge. The
// page logs every event it receives, so a case passes when the page ends in
// the same state as without the gate and Playwright's recorder records the
// same actions.
// usage: node probes/gate-edge.mjs [version]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sleep } from "../lib/pw.mjs";
import { serveFixture } from "../lib/fixture.mjs";
import { createHuman } from "../lib/human.mjs";
import { openRecording } from "../run.mjs";

const version = process.argv[2] ?? "1.65";
const fixture = await serveFixture();
const edge = fixture.origin + "/edge";
const text = (page, id) => page.locator(`#${id}`).textContent();

const cases = {
  "plain click": {
    act: ({ page, human }) => human.clickOn(page.locator("#plain")),
    state: ({ page }) => text(page, "plainCount"),
  },
  "double-click": {
    act: async ({ page, human }) =>
      human.dblclick(...(await human.centre(page.locator("#dbl")))),
    state: ({ page }) => text(page, "dbl"),
  },
  "drag and drop (HTML5 draggable)": {
    act: async ({ page, human }) =>
      human.drag(
        await human.centre(page.locator("#drag")),
        await human.centre(page.locator("#drop"))
      ),
    state: ({ page }) => text(page, "drop"),
  },
  "text selection by dragging": {
    act: async ({ page, human }) => {
      const box = await page.locator("#text").boundingBox();
      await human.drag(
        [box.x + 5, box.y + box.height / 2],
        [box.x + 160, box.y + box.height / 2]
      );
    },
    state: ({ page }) => page.evaluate(() => String(getSelection())),
  },
  "custom slider (pointer events)": {
    act: async ({ page, human }) => {
      const box = await page.locator("#slider").boundingBox();
      await human.drag([box.x + 10, box.y + 10], [box.x + 110, box.y + 10]);
    },
    state: ({ page }) => text(page, "sliderValue"),
  },
  "native range slider": {
    act: async ({ page, human }) => {
      const box = await page.locator("#range").boundingBox();
      await human.click(box.x + box.width * 0.9, box.y + box.height / 2);
    },
    state: ({ page }) => page.locator("#range").inputValue(),
  },
  "native select (keyboard typeahead)": {
    act: async ({ page, human }) => {
      await page.locator("#pick").focus();
      await human.key("c");
    },
    state: ({ page }) => page.locator("#pick").inputValue(),
  },
  "native select (mouse opens the list)": {
    act: async ({ page, human }) => {
      await human.clickOn(page.locator("#pick"));
      await sleep(300);
      await human.key("Escape");
    },
    state: ({ page }) =>
      page.evaluate(() =>
        window.__log
          .filter((l) => l.startsWith("mousedown") || l.startsWith("click"))
          .join(" ")
      ),
  },
  "file chooser": {
    act: async ({ page, human }) => {
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 3000 }),
        human.clickOn(page.locator("#file")),
      ]);
      await chooser.setFiles({
        name: "a.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("x"),
      });
    },
    state: ({ page }) => page.locator("#file").inputValue(),
  },
  "right-click": {
    act: ({ page, human }) =>
      human.clickOn(page.locator("#ctx"), { button: "right" }),
    state: ({ page }) => text(page, "ctx"),
  },
  "link that opens a new tab": {
    act: async ({ page, human, context }) => {
      const popup = context
        .waitForEvent("page", { timeout: 3000 })
        .catch(() => null);
      await human.clickOn(page.locator("#blank"));
      const opened = await popup;
      await opened?.waitForLoadState().catch(() => {});
      page.__popupUrl = opened ? new URL(opened.url()).pathname : "no new tab";
      await opened?.close();
    },
    state: ({ page }) =>
      `${page.__popupUrl}; opener still at ${new URL(page.url()).pathname}`,
  },
  "click inside an iframe": {
    act: ({ page, human }) =>
      human.clickOn(page.frameLocator("#frame").locator("#inner")),
    state: ({ page }) =>
      page.frameLocator("#frame").locator("#innerCount").textContent(),
  },
  "click inside an iframe, page scrolled": {
    act: async ({ page, human }) => {
      await page.evaluate(() => {
        document.body.style.height = "3000px";
        scrollTo(0, 120);
      });
      await human.clickOn(page.frameLocator("#frame").locator("#inner"));
    },
    state: ({ page }) =>
      page.frameLocator("#frame").locator("#innerCount").textContent(),
  },
  "click that navigates, then a click on the new page": {
    act: async ({ page, human }) => {
      await human.clickOn(page.locator("#nav"));
      await page.waitForURL("**/two", { timeout: 3000 }).catch(() => {});
      await sleep(900);
      await human.clickOn(page.locator("#b2"));
    },
    state: ({ page }) => new URL(page.url()).pathname,
  },
  "click on a label of a checkbox": {
    act: async ({ page, human }) => {
      const box = await page.locator("#lbl").boundingBox();
      await human.click(box.x + box.width - 8, box.y + box.height / 2);
    },
    state: ({ page }) => page.locator("#chk").isChecked().then(String),
  },
  "menu that opens on pointerdown": {
    act: ({ page, human }) => human.clickOn(page.locator("#menuBtn")),
    state: ({ page }) => page.locator("#menu").isVisible().then(String),
  },
  "Enter on a focused button": {
    act: async ({ page, human }) => {
      await page.locator("#plain").focus();
      await human.key("Enter");
    },
    state: ({ page }) => text(page, "plainCount"),
  },
  "typing, then Control+a": {
    act: async ({ page, human }) => {
      await human.clickOn(page.locator("#field"));
      await sleep(700);
      await human.type("ab");
      await human.key("a", { modifiers: ["Control"] });
    },
    state: ({ page }) => page.locator("#field").inputValue(),
  },
  "shift+click": {
    act: ({ page, human }) =>
      human.clickOn(page.locator("#plain"), { modifiers: 8 }),
    state: ({ page }) => text(page, "plainCount"),
  },
};

const results = {};
for (const mode of ["before", "gate-a", "gate-b"]) {
  console.log(`== ${mode}`);
  const { browser, context, page, recording } = await openRecording({
    mode,
    version,
    url: edge,
  });
  const human = await createHuman(context, page);
  for (const [name, test] of Object.entries(cases)) {
    await page.goto(edge);
    await recording.rebaseline(page);
    await sleep(200);
    recording.label = name;
    const from = recording.entries.length;
    let error = null;
    try {
      await test.act({ page, human, context });
    } catch (e) {
      error = String(e).split("\n")[0].slice(0, 120);
    }
    await sleep(1300);
    await recording.queue;
    const state = await Promise.resolve()
      .then(() => test.state({ page }))
      .catch((e) => `state failed: ${String(e).split("\n")[0].slice(0, 80)}`);
    const log = await page
      .evaluate(() =>
        (window.__log ?? []).filter(
          (l) => !/^(pointer|mouse(down|up))/.test(l) || true
        )
      )
      .catch(() => []);
    const dropped = await page
      .evaluate(() => window.__aymeGate?.dropped.splice(0) ?? [])
      .catch(() => []);
    // page.goto between cases can surface as a `navigate` action: not a human input
    const recorded = recording.entries
      .slice(from)
      .filter((e) => e.action.name !== "navigate")
      .map((e) => {
        const a = e.action;
        return [
          a.name,
          a.key,
          a.button && a.button !== "left" ? a.button : null,
          a.clickCount !== undefined && a.clickCount !== 1
            ? `x${a.clickCount}`
            : null,
          a.text !== undefined ? JSON.stringify(a.text) : null,
          a.options ? JSON.stringify(a.options) : null,
          `[${e.source}]`,
        ]
          .filter(Boolean)
          .join(" ");
      });
    (results[name] ??= {})[mode] = {
      state,
      recorded,
      appEvents: log.join(" "),
      dropped,
      error,
    };
    console.log(
      `  ${name}: ${state} | ${recorded.join(", ")}${error ? " !! " + error : ""}`
    );
  }
  await recording.stop();
  await browser.close();
}
fixture.close();

const lines = [
  `# Gate edge cases on Playwright ${version}`,
  "",
  "`same` means the page ended in the same state and the recorder recorded the same actions as with no gate.",
  "",
  "| case | no gate: state / recorded | gate A | gate B |",
  "|---|---|---|---|",
];
const strip = (r) =>
  r.recorded.map((x) => x.replace(/ \[[^\]]+\]$/, "")).join(", ");
for (const [name, byMode] of Object.entries(results)) {
  const base = byMode.before;
  const cell = (r) => {
    const same = r.state === base.state && strip(r) === strip(base);
    return `${same ? "same" : "**differs**"}: ${r.state} / ${r.recorded.join(", ") || "nothing"}${r.dropped.length ? ` (gate dropped: ${r.dropped.join(", ")})` : ""}${r.error ? ` (error: ${r.error})` : ""}`;
  };
  lines.push(
    `| ${name} | ${base.state} / ${strip(base) || "nothing"} | ${cell(byMode["gate-a"])} | ${cell(byMode["gate-b"])} |`
  );
}
const outDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "out"
);
fs.mkdirSync(outDir, { recursive: true });
const suffix = process.env.AYME_CHANNEL
  ? `-${process.env.AYME_CHANNEL}-new-headless`
  : "";
fs.writeFileSync(
  path.join(outDir, `gate-edge-pw${version}${suffix}.md`),
  lines.join("\n") + "\n"
);
fs.writeFileSync(
  path.join(outDir, `gate-edge-pw${version}${suffix}.json`),
  JSON.stringify(results, null, 1)
);
console.log("\n" + lines.join("\n"));
