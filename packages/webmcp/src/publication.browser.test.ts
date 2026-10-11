import { createAyme, createPage, type Ayme } from "@ayme-dev/ayme";
import { registerCompiledPom } from "@ayme-dev/ayme/internal";
import type {
  ChromeModelContextExtensions,
  ModelContext,
} from "@mcp-b/webmcp-types";
import { afterEach, beforeAll, expect, it } from "vitest";

// Runs on Chromium's own WebMCP: the browser launches with
// --enable-features=WebMCP,WebMCPTesting (vitest.browser.config.ts).

class TodoPage {
  addTodo(title: string) {
    document
      .querySelector("#todos")!
      .insertAdjacentHTML("beforeend", `<li>${title}</li>`);
  }
}

registerCompiledPom(TodoPage, {
  className: "TodoPage",
  members: [],
  tools: [
    {
      methodName: "addTodo",
      toolName: "TodoPage.addTodo",
      description: "Add a todo with the given title.",
      parameters: [
        { name: "title", optional: false, schema: { type: "string" } },
      ],
    },
  ],
  components: [],
});

const context = () =>
  document.modelContext as ModelContext & ChromeModelContextExtensions;

let ayme: Ayme | undefined;
let stop = () => {};

beforeAll(() => {
  expect(context()?.executeTool).toBeTypeOf("function");
});

afterEach(() => {
  stop();
  ayme?.pom.unregister(TodoPage);
  document.body.innerHTML = "";
});

it("publishes a session's Page Object Tool, and an agent's call runs it as a webmcp Run", async () => {
  document.body.innerHTML = '<ul id="todos"></ul>';
  ayme = createAyme({
    pageFactory: () => createPage(),
    webMCP: { enabled: true, toolNamePrefix: "app_" },
  });
  ayme.pom.register(TodoPage);
  stop = ayme.start();
  await expect.poll(() => ayme!.webMCP.publicationStatus.state).toBe("active");

  const tool = (await context().getTools()).find(
    ({ name }) => name === "app_TodoPage.addTodo"
  );
  expect(tool?.description).toBe("Add a todo with the given title.");
  // Chromium 156 takes the input as an object; older builds took JSON text,
  // as @mcp-b/webmcp-types still declares.
  const output: unknown = await context().executeTool!(tool!, {
    title: "Milk",
  } as never);
  const result = (typeof output === "string" ? JSON.parse(output) : output) as {
    page_changed: boolean;
  };

  expect(result.page_changed).toBe(true);
  expect(document.querySelector("#todos")!.textContent).toBe("Milk");
  expect(ayme.runs.list().at(-1)).toMatchObject({
    tool: "TodoPage.addTodo",
    by: "webmcp",
    status: "succeeded",
  });

  stop();
  stop = () => {};
  expect(ayme.webMCP.publicationStatus.state).toBe("disposed");
  expect(await context().getTools()).toEqual([]);
});
