import { expect, it, vi } from "vitest";

import { AgentConnection } from "../../connection";
import { errorResult } from "../domain/toolResult";
import { callPageTool } from "./callPageTool";

const unknown = (name: string) => errorResult(`Unknown tool "${name}".`);
const saveImage = vi.fn(async (filename: string) => `/tmp/shots/${filename}`);

it("answers that a name is unknown while only an App Process is paired", async () => {
  const connection = new AgentConnection();
  connection
    .attachProcess({ process: "server" })
    .publishTools([
      { name: "peek.node.jobs", description: "", inputSchema: {} },
    ]);

  expect(
    await callPageTool(connection, "peek.node.mail", {}, unknown, saveImage)
  ).toEqual(unknown("peek.node.mail"));
});

it("answers that no page is connected while nothing is paired", async () => {
  const result = await callPageTool(
    new AgentConnection(),
    "peek.counter",
    {},
    unknown,
    saveImage
  );

  expect(result.isError).toBe(true);
  expect(result.content).toEqual([
    { type: "text", text: expect.stringContaining("No page is connected") },
  ]);
});

it("saves the image a page tool returns and gives it to the agent with its path", async () => {
  const connection = new AgentConnection();
  const page = connection.attach(
    { tab: "a", url: "http://127.0.0.1:5173/" },
    () => {}
  )!;
  page.publishTools([{ name: "screenshot", description: "", inputSchema: {} }]);
  const image = {
    type: "image",
    subject: "the viewport",
    filename: "shot.png",
    mimeType: "image/png",
    width: 10,
    height: 10,
    data: "iVBORw0KGgo=",
  };

  const result = callPageTool(connection, "screenshot", {}, unknown, saveImage);
  for await (const call of page.calls(undefined)) {
    page.answer({ callId: call.callId, ok: true, result: image });
    break;
  }

  expect(await result).toEqual({
    content: [
      { type: "image", data: image.data, mimeType: "image/png" },
      {
        type: "text",
        text: "Screenshot of the viewport, 10×10 PNG, saved to /tmp/shots/shot.png.",
      },
    ],
  });
  expect(saveImage).toHaveBeenCalledWith("shot.png", image.data);
});
