import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentConnection,
  RECONNECT_WAIT_MS,
  type PageSession,
} from "../../connection";
import { errorResult, textResult } from "../domain/toolResult";
import { callPageTool } from "./callPageTool";

const unknown = (name: string) => errorResult(`Unknown tool "${name}".`);
const saveImage = vi.fn(async (filename: string) => `/tmp/shots/${filename}`);

it("answers that a name is unknown while only an App Process is paired", async () => {
  const connection = new AgentConnection();
  connection.attachProcess({ process: "server" }).publishTools([
    {
      name: "peek.node.jobs",
      description: "",
      inputSchema: {},
      available: true,
    },
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
  page.publishTools([
    { name: "screenshot", description: "", inputSchema: {}, available: true },
  ]);
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

const pageTool = (name: string) => ({
  name,
  description: "",
  inputSchema: {},
  available: true,
});
const url = "http://127.0.0.1:5173/";

/** Answers `page`'s calls with the page's name, until its channel ends. */
async function answerAs(page: PageSession, signal: AbortSignal) {
  for await (const call of page.calls(signal))
    page.answer({ callId: call.callId, ok: true, result: page.url });
}

describe("a call while the tab loads a new document", () => {
  let ending = new AbortController();
  beforeEach(() => {
    ending = new AbortController();
  });
  afterEach(() => {
    ending.abort();
    vi.useRealTimers();
  });

  const connected = () => {
    const connection = new AgentConnection();
    const page = connection.attach({ tab: "a", url }, () => {})!;
    page.publishTools([pageTool("snapshot")]);
    return { connection, page };
  };
  /** Calls `name`, and tells whether the call has been answered yet. */
  const call = (connection: AgentConnection, name = "snapshot") => {
    let answered = false;
    const result = callPageTool(connection, name, {}, unknown, saveImage);
    void result.then(() => (answered = true));
    return { result, answered: () => answered };
  };
  /** Lets every pending callback run, so a call that is not held goes out. */
  const flush = () => vi.advanceTimersByTimeAsync(0);
  const reconnect = (connection: AgentConnection, at: string) => {
    const next = connection.attach({ tab: "a", url: at }, () => {})!;
    void answerAs(next, ending.signal);
    next.publishTools([pageTool("snapshot")]);
  };
  const leftFor = (to: string) =>
    `The page started loading ${to} and no page reconnected in its place, so the call did not run: the tab closed, or the page it loaded does not run Ayme's Agent Connection.`;

  it("waits for the new page when sent after the page said it is leaving, and runs there", async () => {
    vi.useFakeTimers();
    const { connection, page } = connected();
    page.leaving = { url: `${url}other`, reload: false };

    const { result } = call(connection);
    await flush();
    // The old page reports its tools again as it goes.
    page.publishTools([pageTool("snapshot")]);
    await flush();
    connection.detach(page);
    reconnect(connection, `${url}other`);

    expect(await result).toEqual(textResult(`${url}other`));
  });

  it("waits for the new page when sent while the tab is away, and runs there", async () => {
    vi.useFakeTimers();
    const { connection, page } = connected();
    connection.detach(page);

    const { result } = call(connection);
    await flush();
    reconnect(connection, url);

    expect(await result).toEqual(textResult(url));
  });

  it("waits for a page that paired until it reports its tools", async () => {
    vi.useFakeTimers();
    const connection = new AgentConnection();
    const page = connection.attach({ tab: "a", url }, () => {})!;
    void answerAs(page, ending.signal);

    const { result } = call(connection);
    await flush();
    page.publishTools([pageTool("snapshot")]);

    expect(await result).toEqual(textResult(url));
  });

  it("fails without running when the tab does not come back", async () => {
    vi.useFakeTimers();
    const { connection, page } = connected();
    page.leaving = { url: `${url}plain.html`, reload: false };
    connection.detach(page);

    const { result } = call(connection);
    await vi.advanceTimersByTimeAsync(RECONNECT_WAIT_MS);

    expect(await result).toEqual(errorResult(leftFor(`${url}plain.html`)));
  });

  it("says the page started reloading when a reloading tab does not come back", async () => {
    vi.useFakeTimers();
    const { connection, page } = connected();
    page.leaving = { url, reload: true };
    connection.detach(page);

    const { result } = call(connection);
    await vi.advanceTimersByTimeAsync(RECONNECT_WAIT_MS);

    expect(await result).toEqual(
      errorResult(
        "The page started reloading and no page reconnected in its place, so the call did not run: the tab closed, or the page it loaded does not run Ayme's Agent Connection."
      )
    );
  });

  it("fails without running when the tab closes without a word and does not come back", async () => {
    vi.useFakeTimers();
    const { connection, page } = connected();
    connection.detach(page);

    const { result } = call(connection);
    await vi.advanceTimersByTimeAsync(RECONNECT_WAIT_MS);

    expect(await result).toEqual(
      errorResult(
        "The page's connection closed and its tab did not reconnect, so the call did not run."
      )
    );
  });

  it("waits out the whole reconnect wait of a page that left after the call came", async () => {
    vi.useFakeTimers();
    const { connection, page } = connected();
    page.leaving = { url: `${url}slow`, reload: false };

    const { result, answered } = call(connection);
    await vi.advanceTimersByTimeAsync(RECONNECT_WAIT_MS / 2);
    connection.detach(page);
    await vi.advanceTimersByTimeAsync(RECONNECT_WAIT_MS / 2);
    expect(answered()).toBe(false);
    await vi.advanceTimersByTimeAsync(RECONNECT_WAIT_MS / 2);

    expect(await result).toEqual(errorResult(leftFor(`${url}slow`)));
  });

  it("goes to a page that said it was leaving but stayed, once the wait ends", async () => {
    vi.useFakeTimers();
    const { connection, page } = connected();
    page.leaving = { url: `${url}download`, reload: false };
    void answerAs(page, ending.signal);

    const { result, answered } = call(connection);
    await vi.advanceTimersByTimeAsync(RECONNECT_WAIT_MS - 1);
    expect(answered()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await result).toEqual(textResult(url));
  });

  it("fails without running when the server stops", async () => {
    const { connection, page } = connected();
    connection.detach(page);

    const { result } = call(connection);
    connection.close();

    expect(await result).toEqual(
      errorResult(
        "The Ayme MCP server stopped before the page reconnected, so the call did not run."
      )
    );
  });

  it("goes to an App Process at once", async () => {
    const { connection, page } = connected();
    const process = connection.attachProcess({ process: "server" });
    process.publishTools([pageTool("peek.node.jobs")]);
    connection.detach(page);

    const { result } = call(connection, "peek.node.jobs");
    for await (const sent of process.calls(ending.signal)) {
      process.answer({ callId: sent.callId, ok: true, result: "jobs" });
      break;
    }

    expect(await result).toEqual(textResult("jobs"));
  });
});
