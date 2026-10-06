// Scratch pilot (not committed). Runs the extracted live-tool logic in Node
// against a real Playwright Page driving apps/example-react.
//
//   AYME_PILOT_URL=http://127.0.0.1:4491 node scratch/node-live/pilot.ts
//
// Node 24's native type stripping, not tsx: see the note in liveTools.ts.
// Without AYME_PILOT_URL it loads scratch/node-live/fallback.html (static copy
// of the example's DOM) so the probe can be exercised on a loaded machine.
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { probePomRootState } from "../../src/pomReachability.ts";
import type { PomManifest } from "../../src/contracts.ts";
import { AppPage } from "./AppPage.ts";
import { createLiveTools, playwrightPageDriver } from "./liveTools.ts";

// What unplugin-ayme would emit for AppPage.ts (see derive-manifest.ts).
const appPageManifest: PomManifest = {
  className: "AppPage",
  description: "The React example page.",
  members: [
    {
      memberName: "counter",
      kind: "component",
      access: "field",
      componentClassName: "CounterSection",
      collection: false,
    },
    { memberName: "toggleButton", kind: "locator", access: "field" },
  ],
  components: [
    {
      className: "CounterSection",
      description: "The counter section of the React example.",
      members: [
        { memberName: "root", kind: "locator", access: "field" },
        { memberName: "incrementButton", kind: "locator", access: "field" },
      ],
      tools: [
        {
          methodName: "increment",
          toolName: "CounterSection.increment",
          description: "Increment the counter.",
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
          parameters: [],
        },
      ],
    },
  ],
  tools: [
    {
      methodName: "toggleCounter",
      toolName: "AppPage.toggleCounter",
      description: "Mount or unmount the counter section.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      parameters: [],
    },
  ],
};

const url =
  process.env.AYME_PILOT_URL ??
  pathToFileURL(new URL("./fallback.html", import.meta.url).pathname).href;

const browser = await chromium.launch();
const page = await browser.newPage();
const failures: string[] = [];
const expect = (what: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "ok  " : "FAIL"} ${what}: ${JSON.stringify(actual)}`);
  if (!ok)
    failures.push(
      `${what}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`
    );
};

try {
  await page.goto(url);
  console.log(`page: ${url}`);

  // Validity check 1: the serialized evaluate callback must run in-page. A
  // loader that injects helpers (esbuild keepNames -> __name) would make
  // probePomRootState swallow a ReferenceError and report "absent".
  const serialization = await page
    .locator("body")
    .evaluate((element) => {
      function inner(node: Element): string {
        return node.tagName;
      }
      type Probe = { tag: string };
      const probe: Probe = { tag: inner(element) };
      return probe.tag;
    })
    .then(
      (tag) => `callback ran in page (${tag})`,
      (e: Error) => `callback FAILED: ${e.message}`
    );
  console.log(`serialization: ${serialization}`);

  const app = new AppPage(page);
  const driver = playwrightPageDriver(page);
  const live = createLiveTools(driver);
  const changes: string[][] = [];
  live.subscribe((tools) => changes.push(tools.map((tool) => tool.name)));
  live.register(appPageManifest, app);

  const names = () => live.list().map((tool) => tool.name);
  const counterRoot = () =>
    live
      .observations()
      .get("AppPage")!
      .find((root) => root.path === "counter");

  await live.probe();
  console.log("\n1. Counter mounted");
  expect("counter root", counterRoot(), {
    path: "counter",
    count: 1,
    present: true,
    available: true,
  });
  expect("live tools", names(), [
    "AppPage.toggleCounter",
    "AppPage.counter.increment",
  ]);

  console.log("\n2. Run the live tool AppPage.counter.increment");
  await live
    .list()
    .find((tool) => tool.name === "AppPage.counter.increment")!
    .execute();
  expect(
    "output after increment",
    await page.locator("output").textContent(),
    "1"
  );

  console.log(
    "\n3. Unmount counter through the rootless tool AppPage.toggleCounter"
  );
  await live
    .list()
    .find((tool) => tool.name === "AppPage.toggleCounter")!
    .execute();
  await live.probe();
  expect("counter root", counterRoot(), {
    path: "counter",
    count: 0,
    present: false,
    available: false,
  });
  expect("live tools", names(), ["AppPage.toggleCounter"]);

  console.log(
    "\n4. Mount counter again (through the app's button, not a tool)"
  );
  await page.getByRole("button", { name: "Mount counter" }).click();
  await live.probe();
  expect("counter root", counterRoot(), {
    path: "counter",
    count: 1,
    present: true,
    available: true,
  });
  expect("live tools", names(), [
    "AppPage.toggleCounter",
    "AppPage.counter.increment",
  ]);

  // Validity check 2 and ADR-0020: a modal keeps the root present but makes
  // it unavailable. A swallowed in-page error would read present:false here.
  console.log(
    "\n5. Open a modal dialog over the page (ADR-0020: present, not available)"
  );
  await page.evaluate(() => {
    const dialog = document.createElement("dialog");
    dialog.id = "pilot-modal";
    dialog.textContent = "Blocking modal";
    document.body.append(dialog);
    dialog.showModal();
  });
  await live.probe();
  expect("counter root", counterRoot(), {
    path: "counter",
    count: 1,
    present: true,
    available: false,
  });
  expect("live tools", names(), ["AppPage.toggleCounter"]);
  expect(
    "probePomRootState directly (unchanged production function)",
    await probePomRootState(app.counter.root),
    { present: true, available: false }
  );

  console.log("\n6. Close the modal");
  await page.evaluate(() =>
    (document.getElementById("pilot-modal") as HTMLDialogElement).close()
  );
  await live.probe();
  expect("live tools", names(), [
    "AppPage.toggleCounter",
    "AppPage.counter.increment",
  ]);

  console.log("\n7. Wake-up source: unmount from the page, no explicit probe");
  const before = changes.length;
  await page.getByRole("button", { name: "Unmount counter" }).click();
  await page.waitForTimeout(300);
  expect("subscription fired without probe()", changes.length > before, true);
  expect("live tools", names(), ["AppPage.toggleCounter"]);

  console.log("\nsubscription history:", JSON.stringify(changes));
  live.dispose();
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(
    `\n${failures.length} check(s) failed:\n- ${failures.join("\n- ")}`
  );
  process.exit(1);
}
console.log("\nall checks passed");
