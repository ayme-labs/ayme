import { expect, outline, test } from "./fixtures";

// E2E: the Structure lens on the fixture page, with the real runtime.

test("selecting a structure node highlights it solid on the page", async ({
  inspector,
  listPage,
}) => {
  await inspector.navigator.showLens("Structure");

  await inspector.structure.nodeOf("ListPage.newItemInput").click();
  await inspector.navigator.searchBox.hover();
  await expect.poll(outline(listPage.newItemInput)).toBe("solid");
});

test.describe(() => {
  test.skip(
    ({ placement }) => placement === "external",
    "The hover runs inline only, for the reason modelLens.e2e.ts gives."
  );

  test("hovering a structure node highlights it dashed on the page", async ({
    inspector,
    listPage,
  }) => {
    await inspector.navigator.showLens("Structure");

    await inspector.structure.nodeOf("ListPage.newItemInput").hover();
    await expect.poll(outline(listPage.newItemInput)).toBe("dashed");
  });
});

test("a text field's node offers fill, and a button's does not", async ({
  inspector,
}) => {
  await inspector.navigator.showLens("Structure");

  await inspector.structure.nodeOf("ListPage.newItemInput").click();
  await expect(inspector.detail.node.tool("fill")).toHaveCount(1);

  await inspector.structure.nodeOf("ListPage.addItemButton").click();
  await expect(inspector.detail.node.tool("click")).toHaveCount(1);
  await expect(inspector.detail.node.tool("fill")).toHaveCount(0);
});
