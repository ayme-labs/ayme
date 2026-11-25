import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { Linter } from "eslint";
import tseslint from "typescript-eslint";
import { relativeImports } from "./relative-imports.js";

// Two packages side by side, the first linking the second into its
// node_modules as a workspace does, and a local folder named like the second.
const root = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "relative-imports-"))
);
after(() => fs.rmSync(root, { recursive: true, force: true }));
const write = (file, text) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
};
write("app/package.json", '{ "name": "app" }');
write("app/src/engine/local.ts", "export {};");
write("app/testing/support.ts", "export {};");
write("engine/package.json", '{ "name": "engine" }');
write("engine/src/index.ts", "export {};");
fs.mkdirSync(path.join(root, "app/node_modules"));
fs.symlinkSync(
  path.join(root, "engine"),
  path.join(root, "app/node_modules/engine")
);

const linter = new Linter({ cwd: root });
const config = [
  {
    files: ["**/*.ts"],
    languageOptions: { parser: tseslint.parser },
  },
  relativeImports(
    ["**/*.ts"],
    [
      { package: "^engine$", message: "engine", allowTypeImports: true },
      { folder: path.join(root, "app/testing"), message: "testing" },
    ]
  ),
];

/** The messages for `code` in `app/src/file.ts`. */
const lint = (code) =>
  linter
    .verify(code, config, { filename: path.join(root, "app/src/file.ts") })
    .map(({ message }) => message);

test("a relative path into another package is refused by its name", () => {
  for (const code of [
    'export * from "../../engine/src";',
    'export const load = () => import("../node_modules/engine/src/index");',
    "export const load = () => import(`../../engine`);",
    'import { type Engine } from "../../engine/src";',
  ])
    assert.deepEqual(lint(code), ["engine"], code);
});

test("a type import is let through when the target allows it", () => {
  for (const code of [
    'import type { Engine } from "../../engine/src";',
    'export type { Engine } from "../node_modules/engine/src";',
    'export type Engine = import("../../engine/src").Engine;',
  ])
    assert.deepEqual(lint(code), [], code);
});

test("a local folder named like the package is not the package", () => {
  assert.deepEqual(lint('export * from "./engine/local";'), []);
});

test("a relative path into a folder is refused, whatever it spells", () => {
  assert.deepEqual(lint('export * from "../testing/support";'), ["testing"]);
  assert.deepEqual(lint('export * from "./../testing";'), ["testing"]);
  assert.deepEqual(lint('export * from "../src/../testing/support";'), [
    "testing",
  ]);
});

test("a package name or a computed import() is not a relative path", () => {
  assert.deepEqual(lint('export * from "engine";'), []);
  assert.deepEqual(
    lint("export const load = (name: string) => import(`../${name}`);"),
    []
  );
});
