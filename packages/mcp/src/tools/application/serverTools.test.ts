import { expect, it } from "vitest";

import { AgentConnection } from "../../connection";
import {
  errorResult,
  notConnectedResult,
  textResult,
} from "../domain/toolResult";
import { callTool } from "./callTool";
import { connectTool } from "./connectTool";
import { inspectTool } from "./inspectTool";
import { listToolsTool } from "./listToolsTool";

const context = () => ({
  connection: new AgentConnection(),
  pairing: { address: "ws://127.0.0.1:9351", token: "f00d" },
  saveImage: async (filename: string) => `/tmp/${filename}`,
  wasOffered: () => false,
  inspector: {
    url: "http://127.0.0.1:9351/inspector",
    installed: async () => true,
  },
});

it("ayme_connect returns the connect link for the app's URL", async () => {
  expect(
    await connectTool(context()).call({ url: "http://localhost:5173/" })
  ).toEqual(textResult("http://localhost:5173/#ayme=ws://127.0.0.1:9351/f00d"));
  expect(await connectTool(context()).call({ url: "localhost:5173" })).toEqual(
    errorResult('Expected an http or https URL, got "localhost:5173".')
  );
});

it("ayme_connect names the init script of the Page Objects the server serves", async () => {
  expect(
    await connectTool({
      ...context(),
      initScript: "/work/.ayme/init-script.js",
    }).call({ url: "http://localhost:5173/" })
  ).toEqual({
    content: [
      {
        type: "text",
        text: "http://localhost:5173/#ayme=ws://127.0.0.1:9351/f00d",
      },
      {
        type: "text",
        text: "This server serves Page Objects to pages that load /work/.ayme/init-script.js.",
      },
    ],
  });
});

it("ayme_list_tools and ayme_call say no page is connected while nothing is paired", async () => {
  expect(await listToolsTool(context()).call({})).toEqual(notConnectedResult());
  expect(await callTool(context()).call({ tool: "peek" })).toEqual(
    notConnectedResult()
  );
});

it("ayme_inspect returns the URL of the Inspector the server serves", async () => {
  expect(await inspectTool(context()).call({})).toEqual(
    textResult("http://127.0.0.1:9351/inspector")
  );
});

it("ayme_inspect says to install @ayme-dev/inspector when it is missing", async () => {
  const missing = {
    ...context(),
    inspector: {
      url: "http://127.0.0.1:9351/inspector",
      installed: async () => false,
    },
  };

  expect(await inspectTool(missing).call({})).toEqual(
    errorResult(
      expect.stringContaining("npm install --save-dev @ayme-dev/inspector")
    )
  );
});
