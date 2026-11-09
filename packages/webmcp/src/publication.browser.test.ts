import {
  createAyme,
  createPage,
  type Ayme,
  type AymePage as Page,
} from "@ayme-dev/ayme";
import { registerCompiledPom } from "@ayme-dev/ayme/internal";
import type {} from "webmcp-types";
import { afterEach, beforeAll, expect, it } from "vitest";

// Runs on Chromium's own WebMCP: the browser launches with
// --enable-features=WebMCP,WebMCPTesting (vitest.browser.config.ts).

class TodoPage {
  constructor(private readonly page: Page) {}

  get todos() {
    return this.page.getByRole("list");
  }

  addTodo(title: string) {
    document
      .querySelector("#todos")!
      .insertAdjacentHTML("beforeend", `<li>${title}</li>`);
  }
}

registerCompiledPom(TodoPage, {
  className: "TodoPage",
  members: [{ memberName: "todos", kind: "locator", access: "getter" }],
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

const context = () => document.modelContext!;

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

it("publishes a session's Page Object Tool and page_objects, and an agent's call runs it as a webmcp Run", async () => {
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
  // Chromium 156 takes the input as an object; older builds took JSON text.
  const output: unknown = await context().executeTool!(tool!, {
    title: "Milk",
  });
  const result = (typeof output === "string" ? JSON.parse(output) : output) as {
    settled: boolean;
    changes?: string;
  };

  expect(result).toEqual({
    settled: true,
    changes: expect.stringContaining("listitem: Milk"),
  });
  expect(document.querySelector("#todos")!.textContent).toBe("Milk");
  expect(ayme.runs.list().at(-1)).toMatchObject({
    tool: "TodoPage.addTodo",
    by: "webmcp",
    status: "succeeded",
  });

  const pageObjects = (await context().getTools()).find(
    ({ name }) => name === "app_page_objects"
  );
  const screen: unknown = await context().executeTool!(pageObjects!, {});
  expect(JSON.stringify(screen)).toContain("TodoPage");
  expect(JSON.stringify(screen)).toContain("listitem: Milk");

  stop();
  stop = () => {};
  expect(ayme.webMCP.publicationStatus.state).toBe("disposed");
  expect(await context().getTools()).toEqual([]);
});
