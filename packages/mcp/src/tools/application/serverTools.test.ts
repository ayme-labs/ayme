import { expect, it } from "vitest";

import { AgentConnection } from "../../connection";
import {
  errorResult,
  type FailedPageObjects,
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
  failedPageObjects: async () => undefined,
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

/**
 * A context whose served Page Objects have no good build until `fix()`.
 */
const failingBuild = () => {
  let failed: FailedPageObjects | undefined = {
    entry: "/work/.ayme/page-objects.ts",
    error:
      "Could not read TypeScript project configuration /work/tsconfig.json: No inputs were found in config file.",
    watching: true,
  };
  return {
    context: {
      ...context(),
      initScript: "/work/.ayme/init-script.js",
      failedPageObjects: async () => failed,
    },
    fix: () => (failed = undefined),
  };
};

it("ayme_connect says the Page Objects did not build, with the first error, until a build succeeds", async () => {
  const { context, fix } = failingBuild();
  const connect = connectTool(context);

  const { content, isError } = await connect.call({
    url: "http://localhost:5173/",
  });

  expect(isError).toBeUndefined();
  expect(content[0]).toEqual({
    type: "text",
    text: "http://localhost:5173/#ayme=ws://127.0.0.1:9351/f00d",
  });
  const note = (content[1] as { text: string }).text;
  expect(note).toContain(
    "The Page Objects entry /work/.ayme/page-objects.ts did not build"
  );
  expect(note).toContain("No inputs were found in config file.");
  expect(note).toContain(
    "The server is watching for changes: it rebuilds the entry when a file it read changes."
  );
  expect(note).toContain(
    "Once it builds, this server serves Page Objects to pages that load /work/.ayme/init-script.js."
  );
  expect(note).not.toContain("Fix it");
  expect(note).not.toContain("Make the");
  expect(note).not.toMatch(/^This server serves Page Objects/);

  fix();
  expect(
    (await connect.call({ url: "http://localhost:5173/" })).content[1]
  ).toEqual({
    type: "text",
    text: "This server serves Page Objects to pages that load /work/.ayme/init-script.js.",
  });
});

it("ayme_connect does not promise a build when the server is not watching", async () => {
  const { context } = failingBuild();
  const failed = (await context.failedPageObjects())!;
  const result = await connectTool({
    ...context,
    failedPageObjects: async () => ({ ...failed, watching: false }),
  }).call({ url: "http://localhost:5173/" });

  expect((result.content[1] as { text: string }).text).toMatch(
    /The server is not watching for changes: the build could not start, so no file is watched\.$/
  );
});

it("ayme_list_tools and ayme_call say the Page Objects did not build while no page is connected, until a build succeeds", async () => {
  const { context, fix } = failingBuild();

  for (const tool of [listToolsTool(context), callTool(context)]) {
    const result = await tool.call({ tool: "peek" });
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toEqual({
      type: "text",
      text: expect.stringMatching(
        /^No page is connected\. The Page Objects entry \/work\/\.ayme\/page-objects\.ts did not build.*No inputs were found/
      ),
    });
  }

  fix();
  const noPage = {
    content: [{ type: "text", text: "No page is connected." }],
    isError: true,
  };
  expect(await listToolsTool(context).call({})).toEqual(noPage);
  expect(await callTool(context).call({ tool: "peek" })).toEqual(noPage);
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
