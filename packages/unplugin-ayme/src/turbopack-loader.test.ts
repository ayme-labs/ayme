import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it, vi } from "vitest";

import turbopackLoader from "./turbopack-loader";

const resourcePath = fileURLToPath(
  new URL("./__tests__/fixtures/turbopack/CounterPage.ts", import.meta.url)
);

function loaderContext(fileName = resourcePath) {
  const dependencies: string[] = [];
  return {
    dependencies,
    context: {
      resourcePath: fileName,
      getOptions: () => ({ include: true }),
      addDependency: (dependency: string) => dependencies.push(dependency),
    },
  };
}

it("emits POM registration, JavaScript and compiler dependencies", () => {
  const { context, dependencies } = loaderContext();
  const code = turbopackLoader.call(
    context,
    readFileSync(resourcePath, "utf8")
  );
  expect(code).toMatch(/registerCompiledPom\(CounterPage,/);
  expect(code).toContain('"className": "CounterPage"');
  expect(code).toContain('"methodName": "increment"');
  expect(code).toContain('"methodName": "setMode"');
  expect(code).toContain('"enum": ["single", "double"]');
  expect(code).not.toContain("@ayme.action");
  expect(code).not.toContain("@playwright/test");
  expect(code).not.toContain("readonly incrementButton: Locator");
  expect(dependencies).toContain(
    path.join(path.dirname(resourcePath), "tsconfig.json")
  );
  expect(dependencies).toContain(
    path.join(path.dirname(resourcePath), "CounterMode.ts")
  );
});

it("registers a subclass whose file has no decorator but extends a decorated base", () => {
  const subclassPath = path.join(
    path.dirname(resourcePath),
    "SubCounterPage.ts"
  );
  const { context, dependencies } = loaderContext(subclassPath);
  const code = turbopackLoader.call(
    context,
    readFileSync(subclassPath, "utf8")
  );
  expect(code).toMatch(/registerCompiledPom\(SubCounterPage,/);
  expect(code).toContain('"toolName": "SubCounterPage.increment"');
  expect(dependencies).toContain(resourcePath);
});

it("reports compiler dependencies when deriving the manifest fails", () => {
  // Otherwise Turbopack keeps the failure, even across restarts, until the
  // Page Object itself changes: restoring the imported type does not rerun it.
  const truncatedPath = path.join(
    path.dirname(resourcePath),
    "TruncatedModePage.ts"
  );
  const { context, dependencies } = loaderContext(truncatedPath);
  expect(() =>
    turbopackLoader.call(context, readFileSync(truncatedPath, "utf8"))
  ).toThrow(
    "Unsupported Page Object Tool input type for TruncatedModePage.setMode(mode): CounterMode."
  );
  expect(dependencies).toContain(
    path.join(path.dirname(resourcePath), "TruncatedMode.ts")
  );
});

it("transpiles ordinary TypeScript when no POM transform is needed", () => {
  const { context } = loaderContext("/unused/plain.ts");
  const code = turbopackLoader.call(
    context,
    "export const answer: number = 42;"
  );
  expect(code).toContain("export const answer = 42;");
  expect(code).not.toContain("registerCompiledPom");
});

it("rejects a compiler transform when dependency tracking is unavailable", () => {
  expect(() =>
    turbopackLoader.call(
      { resourcePath, getOptions: () => ({}) },
      readFileSync(resourcePath, "utf8")
    )
  ).toThrow("requires loader dependency tracking");
});

it("reports invalid TypeScript instead of returning broken JavaScript", () => {
  const { context } = loaderContext();
  expect(() =>
    turbopackLoader.call(context, "export const broken: = ;")
  ).toThrow("Could not transpile Ayme POM");
});

it("compiles a Page Object Model to a stand-in in a build without Ayme, the default", () => {
  const { context } = loaderContext();
  const code = turbopackLoader.call(
    { ...context, getOptions: () => ({}) },
    readFileSync(resourcePath, "utf8")
  );
  expect(code).toContain("from '@ayme-dev/ayme/absent'");
  expect(code).toMatch(
    /class CounterPage extends absentPageObject\("CounterPage", \{ "actions": \["increment", "setMode"\]/
  );
  expect(code).not.toContain("registerCompiledPom");
  expect(code).not.toContain("Increment the counter.");
  expect(code).not.toContain("getByRole");
  expect(code).not.toContain('@ayme-dev/ayme"');
});

it("rejects an include that is not a boolean", () => {
  const { context } = loaderContext();
  expect(() =>
    turbopackLoader.call(
      {
        ...context,
        getOptions: () => ({ include: "yes" as unknown as boolean }),
      },
      readFileSync(resourcePath, "utf8")
    )
  ).toThrow(new TypeError("include must be a boolean"));
});

it.each([
  [
    "include unset",
    {},
    "[ayme] Ayme is not in this build: include is not set.",
  ],
  [
    "include false",
    { include: false },
    "[ayme] Ayme is not in this build: include is false.",
  ],
  [
    "include true",
    { include: true },
    "[ayme] Ayme is in this build: include is true.",
  ],
])(
  "prints once per process whether Ayme is in it, with %s",
  async (_, options, line) => {
    // The loader runs per module, so the line belongs to the process: a fresh
    // module instance stands in for a fresh one.
    vi.resetModules();
    const { default: loader } = await import("./turbopack-loader");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const { context } = loaderContext();
      const source = readFileSync(resourcePath, "utf8");
      loader.call({ ...context, getOptions: () => options }, source);
      loader.call({ ...context, getOptions: () => options }, source);
      expect(
        info.mock.calls
          .map(([message]) => String(message))
          .filter((message) => message.startsWith("[ayme] Ayme"))
      ).toEqual([line]);
    } finally {
      info.mockRestore();
    }
  }
);
