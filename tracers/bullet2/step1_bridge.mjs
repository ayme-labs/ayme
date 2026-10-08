import { chromium, aiCapture, SyntheticAriaRefFactory, StructuralTree, renderTreeText, executePublishedTool, openBrowserPage, renderChangeRecord } from "./common.mjs";
const browser = await chromium.launch();
try {
  const { page } = await openBrowserPage(browser, "step1");
  const f = new SyntheticAriaRefFactory();
  const a = await aiCapture(page, f), b = await aiCapture(page, f);
  console.log("ai yaml identical twice:", a.yaml === b.yaml);
  console.log("reconcile a->b hasAnyChanges:", StructuralTree.reconcile(a.tree, b.tree).hasAnyChanges());
  await page.getByRole("button", { name: "Increment", exact: true }).click();
  const c = await aiCapture(page, f);
  console.log("--- ai yaml after increment\n" + c.yaml);
  console.log("--- reconcile b->c\n" + renderChangeRecord(StructuralTree.reconcile(b.tree, c.tree)));
  console.log("--- Node tree text (before increment)\n" + renderTreeText(b.tree));
  const snap = await executePublishedTool(page, "snapshot", {});
  console.log("--- browser snapshot tool result\n" + (typeof snap === "string" ? snap : JSON.stringify(snap, null, 1)));
} finally { await browser.close(); }
