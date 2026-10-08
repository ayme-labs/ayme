import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPage } from "./browserPage";
import { ToolInputError } from "./errors";
import { buildToolOptions } from "./goalLoopQuestions";
import { INSPECTOR_DOGFOOD_ATTRIBUTE } from "./pageState";
import {
  PLAYWRIGHT_MCP_SCREENSHOT_SCHEMA,
  shapeOf,
  withoutElement,
} from "./playwrightMcp.testSupport";
import { createAyme, type Ayme } from "./runtime";
import type { ToolInput } from "./toolTypes";
import { synchronizeWebMcpTools } from "./webMcp";

const FIXTURE = `
  <style>
    body { margin: 0; background: rgb(255, 255, 255); }
    #box { width: 120px; height: 80px; background: rgb(0, 0, 255); }
    #inspector {
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgb(255, 0, 0);
    }
  </style>
  <div id="box" role="img" aria-label="Box"></div>
`;

/** The color of one pixel of a base64 image, as "r,g,b". */
async function pixel(data: string, x: number, y: number) {
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d")!;
  context.drawImage(bitmap, 0, 0);
  const [r, g, b] = context.getImageData(x, y, 1, 1).data;
  return `${r},${g},${b}`;
}

describe("screenshot in Chromium", () => {
  let ayme: Ayme;
  let stop: () => void;

  beforeEach(() => {
    document.body.innerHTML = FIXTURE;
    ayme = createAyme({
      pageFactory: () => createPage({ actionTimeout: 2_000 }),
    });
    stop = ayme.start();
  });

  afterEach(() => {
    stop();
    document.body.innerHTML = "";
  });

  const run = (input: ToolInput<"screenshot">) =>
    ayme.tools.run("screenshot", input);

  function mountInspector({ dogfood }: { dogfood: boolean }) {
    const host = document.createElement("div");
    host.id = "inspector";
    host.setAttribute("data-ayme-inspector-host", "");
    if (dogfood) host.setAttribute(INSPECTOR_DOGFOOD_ATTRIBUTE, "");
    document.body.append(host);
  }

  it("is a live Browser Tool with Playwright MCP's input fields, without element", () => {
    const info = ayme.tools.list().find(({ name }) => name === "screenshot");
    expect(info?.group).toBe("browser");
    expect(shapeOf(info?.inputSchema)).toEqual(
      withoutElement(PLAYWRIGHT_MCP_SCREENSHOT_SCHEMA)
    );
  });

  it("is never published to WebMCP, and the Goal Loop never picks it", async () => {
    const names: string[] = [];
    const publication = await synchronizeWebMcpTools({
      async registerTool(tool: { name: string }) {
        names.push(tool.name);
      },
    } as never);
    publication.dispose();

    expect(names).toContain("snapshot");
    expect(names).not.toContain("screenshot");
    expect(buildToolOptions().map((option) => option.key)).not.toContain(
      "screenshot"
    );
  });

  it("captures the viewport as a png image", async () => {
    const result = await run({});

    expect(result).toMatchObject({
      type: "image",
      subject: "the viewport",
      mimeType: "image/png",
      width: window.innerWidth,
      height: window.innerHeight,
      filename: expect.stringMatching(/^page-[\dT-]+Z\.png$/),
    });
    expect(await pixel(result.data, 10, 10)).toBe("0,0,255");
  });

  it("captures one element, addressed by ref or selector, as jpeg", async () => {
    const { structure } = await ayme.tools.run("snapshot", {});
    const ref = structure.match(/(e\d+) img "Box"/)?.[1];
    expect(ref).toBeDefined();

    for (const target of [ref!, "#box"]) {
      const result = await run({ target, filename: "box.jpg" });
      expect(result).toMatchObject({
        subject: `element ${target}`,
        filename: "box.jpg",
        mimeType: "image/jpeg",
        width: 120,
        height: 80,
      });
    }
  });

  it("refuses a filename that is not a bare name", async () => {
    await expect(run({ filename: "../box.png" })).rejects.toThrow(
      ToolInputError
    );
  });

  it("hides the Inspector from the capture", async () => {
    mountInspector({ dogfood: false });

    expect(await pixel((await run({})).data, 10, 10)).toBe("0,0,255");
  });

  it("shows the Inspector when the page dogfoods it", async () => {
    mountInspector({ dogfood: true });

    expect(await pixel((await run({})).data, 10, 10)).toBe("255,0,0");
  });
});
