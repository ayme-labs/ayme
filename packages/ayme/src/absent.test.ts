import { afterEach, describe, expect, it, vi } from "vitest";

import {
  absentPageObject,
  createAyme,
  createPage,
  decisionEndpoint,
  getStartedAyme,
  RuntimeStateError,
} from "./absent";

// The entry a build without Ayme resolves `@ayme-dev/ayme` to: inert, and
// every use of what the build left out fails naming it.

const removed = expect.objectContaining({
  name: "RuntimeStateError",
  message: expect.stringContaining("Ayme was removed from this build."),
});

describe("the absent session", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts nothing, publishes nothing and lists no tools or runs", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const session = createAyme({ webMCP: { enabled: true }, inspector: true });
    const stop = session.start();
    expect(getStartedAyme()).toBeUndefined();
    expect(session.webMCP.publicationStatus.state).toBe("disabled");
    expect(session.webMCP.publicationStatus.message).toContain(
      "Ayme was removed from this build."
    );
    expect(session.tools.list()).toEqual([]);
    expect(session.runs.list()).toEqual([]);
    expect(session.tools.subscribe(() => {})).toBeTypeOf("function");
    expect(session.webMCP.retryPublication()).toBeInstanceOf(Promise);
    expect(session.peek(() => 1, "state")).toBeTypeOf("function");
    stop();
  });

  describe("set up with WebMCP publication enabled", () => {
    it("logs one error saying so and stays inert", () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const session = createAyme({ webMCP: { enabled: true } });
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged).toHaveBeenCalledWith(
        "Ayme was removed from this build, but setup enables WebMCP publication."
      );
      expect(session.webMCP.publicationStatus.state).toBe("disabled");
      expect(session.tools.list()).toEqual([]);
    });

    it("logs nothing when publication is off or unset", () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      createAyme({ webMCP: { enabled: false } });
      createAyme({ webMCP: {} });
      createAyme({});
      createAyme();
      expect(logged).not.toHaveBeenCalled();
    });
  });

  it("rejects a tool run, naming the tool", async () => {
    await expect(
      createAyme().tools.run("ListPage.addItem", { name: "Eggs" })
    ).rejects.toEqual(removed);
    await expect(
      createAyme().tools.run("ListPage.addItem", { name: "Eggs" })
    ).rejects.toThrow('The tool "ListPage.addItem" is not in it.');
  });

  it("gives each Page Object class one instance without running its constructor", () => {
    class ListPage {
      constructor() {
        throw new Error("constructed");
      }
    }
    const session = createAyme();
    const instance = session.pom.register(ListPage);
    expect(instance).toBeInstanceOf(ListPage);
    expect(session.pom.get(ListPage)).toBe(instance);
    expect(session.pom.register(ListPage)).toBe(instance);
    session.pom.unregister(ListPage);
    expect(session.pom.get(ListPage)).toBe(instance);
  });

  it("has no page and no Decision Endpoint", async () => {
    expect(() => createPage()).toThrow(RuntimeStateError);
    expect(() => createPage()).toThrow("The browser page is not in it.");
    await expect(decisionEndpoint()()).rejects.toThrow(
      "The Decision Endpoint is not in it."
    );
  });
});

describe("a Page Object stand-in", () => {
  class ListPage extends absentPageObject("ListPage", {
    actions: ["addItem", "clear"],
    properties: ["dialog"],
    methods: ["items"],
  }) {}

  it("rejects its actions, naming each", async () => {
    const page = createAyme().pom.get(ListPage) as ListPage & {
      addItem(name: string): Promise<void>;
    };
    await expect(page.addItem("Eggs")).rejects.toEqual(removed);
    await expect(page.addItem("Eggs")).rejects.toThrow(
      "ListPage.addItem is not in it."
    );
  });

  it("throws on its Page Object Children, naming each", () => {
    const page = new ListPage() as ListPage & {
      dialog: unknown;
      items(): unknown;
    };
    expect(() => page.dialog).toThrow(RuntimeStateError);
    expect(() => page.dialog).toThrow("ListPage.dialog is not in it.");
    expect(() => page.items()).toThrow("ListPage.items is not in it.");
  });

  it("has no other member", () => {
    expect(Object.getOwnPropertyNames(ListPage.prototype).sort()).toEqual([
      "constructor",
    ]);
    expect(
      Object.getOwnPropertyNames(
        Object.getPrototypeOf(ListPage.prototype) as object
      ).sort()
    ).toEqual(["addItem", "clear", "constructor", "dialog", "items"]);
  });
});
