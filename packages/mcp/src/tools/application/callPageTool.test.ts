import { expect, it } from "vitest";

import { AgentConnection } from "../../connection";
import { errorResult } from "../domain/toolResult";
import { callPageTool } from "./callPageTool";

const unknown = (name: string) => errorResult(`Unknown tool "${name}".`);

it("answers that a name is unknown while only an App Process is paired", async () => {
  const connection = new AgentConnection();
  connection
    .attachProcess({ process: "server" })
    .publishTools([
      { name: "peek.node.jobs", description: "", inputSchema: {} },
    ]);

  expect(await callPageTool(connection, "peek.node.mail", {}, unknown)).toEqual(
    unknown("peek.node.mail")
  );
});

it("answers that no page is connected while nothing is paired", async () => {
  const result = await callPageTool(
    new AgentConnection(),
    "peek.counter",
    {},
    unknown
  );

  expect(result.isError).toBe(true);
  expect(result.content).toEqual([
    { type: "text", text: expect.stringContaining("No page is connected") },
  ]);
});
