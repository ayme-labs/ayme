import { expect, it } from "vitest";

import { AgentConnection } from "../../connection";
import type { SettledBuildState } from "../../served-page-objects";
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
  wasOffered: () => false,
  pageObjectsBuildState: async () => undefined,
  inspector: {
    url: "http://127.0.0.1:9351/inspector",
    installed: async () => true,
    appPage: async () => "<!doctype html>",
    socketOrigin: "ws://127.0.0.1:9351",
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

it("ayme_connect names the init script of the Page Objects the server serves, in one text item with the link on its own line", async () => {
  expect(
    await connectTool({
      ...context(),
      initScript: "/work/ayme/init-script.js",
    }).call({ url: "http://localhost:5173/" })
  ).toEqual({
    content: [
      {
        type: "text",
        text: "http://localhost:5173/#ayme=ws://127.0.0.1:9351/f00d\n\nThis server serves Page Objects to pages that load /work/ayme/init-script.js.",
      },
    ],
  });
});

/** The link and the note after it, of `ayme_connect`'s one text item. */
const linkAndNote = ({ content }: { content: unknown[] }) => {
  expect(content).toHaveLength(1);
  const [link, ...note] = (content[0] as { text: string }).text.split("\n\n");
  return { link, note: note.join("\n\n") };
};

/**
 * A context whose served Page Objects have no good build until `fix()`.
 */
const failingBuild = () => {
  const entry = "/work/ayme/page-objects.ts";
  const errors = [
    {
      text: "Could not read TypeScript project configuration /work/tsconfig.json: No inputs were found in config file.",
      location: null,
    },
  ];
  let state: SettledBuildState = { kind: "never-built", entry, errors };
  const modules = new Map([["entry.js", "code"]]);
  return {
    context: {
      ...context(),
      initScript: "/work/ayme/init-script.js",
      pageObjectsBuildState: async () => state,
    },
    fix: () => {
      state = { kind: "built", entry, modules };
    },
    failRebuild: () => {
      state = { kind: "rebuild-failed", entry, modules, errors };
    },
  };
};

it("ayme_connect says the Page Objects did not build, with the first error, until a build succeeds", async () => {
  const { context, fix, failRebuild } = failingBuild();
  const connect = connectTool(context);

  const { content, isError } = await connect.call({
    url: "http://localhost:5173/",
  });

  expect(isError).toBeUndefined();
  const { link, note } = linkAndNote({ content });
  expect(link).toBe("http://localhost:5173/#ayme=ws://127.0.0.1:9351/f00d");
  expect(note).toContain(
    "The Page Objects entry /work/ayme/page-objects.ts did not build"
  );
  expect(note).toContain("No inputs were found in config file.");
  expect(note).toContain(
    "The server is watching for changes: it rebuilds the entry when a file it read changes."
  );
  expect(note).toContain(
    "Once it builds, this server serves Page Objects to pages that load /work/ayme/init-script.js."
  );
  expect(note).not.toContain("Fix it");
  expect(note).not.toContain("Make the");
  expect(note).not.toMatch(/^This server serves Page Objects/);

  for (const change of [fix, failRebuild]) {
    change();
    expect(
      linkAndNote(await connect.call({ url: "http://localhost:5173/" })).note
    ).toBe(
      "This server serves Page Objects to pages that load /work/ayme/init-script.js."
    );
  }
});

it("ayme_connect does not promise a build when the server is not watching", async () => {
  const { context } = failingBuild();
  const result = await connectTool({
    ...context,
    pageObjectsBuildState: async () => ({
      kind: "cannot-start",
      entry: "/work/ayme/page-objects.ts",
      error: "Missing compiler.",
    }),
  }).call({ url: "http://localhost:5173/" });

  expect(linkAndNote(result).note).toMatch(
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
        /^No page is connected\. The Page Objects entry \/work\/ayme\/page-objects\.ts did not build.*No inputs were found/
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
    inspector: { ...context().inspector, installed: async () => false },
  };

  expect(await inspectTool(missing).call({})).toEqual(
    errorResult(
      expect.stringContaining("npm install --save-dev @ayme-dev/inspector")
    )
  );
});

it("ayme_list_tools right after ayme_connect waits for the page the link opens and lists its tools", async () => {
  const ctx = context();
  await connectTool(ctx).call({ url: "http://localhost:5173/" });
  const listing = listToolsTool(ctx).call({});

  ctx.connection
    .attach({ tab: "a", url: "http://localhost:5173/" }, () => {})!
    .publishTools([
      {
        name: "Panel.remove",
        description: "Removes the panel.",
        inputSchema: { type: "object" },
        available: true,
      },
    ]);

  const [text] = (await listing).content as { text: string }[];
  expect(
    (JSON.parse(text!.text) as { name: string }[]).map(({ name }) => name)
  ).toEqual(["Panel.remove"]);
});
