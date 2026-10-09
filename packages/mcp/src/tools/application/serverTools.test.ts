import { expect, it } from "vitest";

import { AgentConnection } from "../../connection";
import {
  errorResult,
  notConnectedResult,
  textResult,
} from "../domain/toolResult";
import { callTool } from "./callTool";
import { connectTool } from "./connectTool";
import { listToolsTool } from "./listToolsTool";

const context = () => ({
  connection: new AgentConnection(),
  pairing: { address: "ws://127.0.0.1:9351", token: "f00d" },
  saveImage: async (filename: string) => `/tmp/${filename}`,
});

it("ayme_connect returns the connect link for the app's URL", async () => {
  expect(
    await connectTool(context()).call({ url: "http://localhost:5173/" })
  ).toEqual(textResult("http://localhost:5173/#ayme=ws://127.0.0.1:9351/f00d"));
  expect(await connectTool(context()).call({ url: "localhost:5173" })).toEqual(
    errorResult('Expected an http or https URL, got "localhost:5173".')
  );
});

it("ayme_list_tools and ayme_call say no page is connected while nothing is paired", async () => {
  expect(await listToolsTool(context()).call({})).toEqual(notConnectedResult());
  expect(await callTool(context()).call({ tool: "peek" })).toEqual(
    notConnectedResult()
  );
});
