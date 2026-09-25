import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

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
      getOptions: () => ({}),
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
  expect(code).not.toContain("@WebMCP");
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
