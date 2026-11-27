import { Effect } from "effect";
import { expect, it } from "vitest";

import { buildFailed, compileErrors, pageObjectClasses } from "./builtEntry";

const entry = "/app/ayme/page-objects.ts";

class Basket {}
class Checkout {}

it("takes the classes the entry's default export lists", async () => {
  expect(
    await Effect.runPromise(
      pageObjectClasses({ default: [Basket, Checkout] }, entry)
    )
  ).toEqual([Basket, Checkout]);
});

it.each([[{}], [{ default: Basket }], [{ default: [Basket, "Checkout"] }]])(
  "refuses an entry whose default export is not an array of classes: %o",
  async (module) => {
    const error = await Effect.runPromise(
      Effect.flip(pageObjectClasses(module, entry))
    );
    expect(error.message).toBe(
      "The default export of /app/ayme/page-objects.ts is not an array of Page Object classes. List the project's Page Object classes in it: export default [Basket, Checkout];"
    );
  }
);

it("says which entry did not build, above the build's own messages", () => {
  expect(
    buildFailed(entry, [
      'ayme/pom/Basket.ts:3:9: ERROR: Expected ";" but found "basket"\n',
      'ayme/pom/Checkout.ts:1:0: ERROR: Could not resolve "./Cart"\n',
    ]).message
  ).toBe(
    'The Page Objects of /app/ayme/page-objects.ts did not build:\nayme/pom/Basket.ts:3:9: ERROR: Expected ";" but found "basket"\nayme/pom/Checkout.ts:1:0: ERROR: Could not resolve "./Cart"'
  );
});

it("names the first error on one line, with where it is when esbuild says", () => {
  expect(
    buildFailed(
      entry,
      ["the formatted messages"],
      [
        {
          text: 'Expected ";" but found "basket"',
          location: { file: "ayme/pom/Basket.ts", line: 3, column: 9 },
        },
        { text: "Could not resolve" },
      ]
    ).first
  ).toBe('ayme/pom/Basket.ts:3:9: Expected ";" but found "basket"');
  expect(buildFailed(entry, ["m"], [{ text: "No entry." }]).first).toBe(
    "No entry."
  );
  expect(buildFailed(entry, ["m"]).first).toBeUndefined();
});

it("puts each of the compiler's diagnostics where it names, or at the module it compiled", () => {
  expect(
    compileErrors(
      [
        { text: "No tsconfig.json reaches the module." },
        { text: "The tsconfig is not valid.", file: "/app/ayme/tsconfig.json" },
        {
          text: "@ayme.action needs a method.",
          file: "/app/ayme/pom/Basket.ts",
          line: 4,
          column: 3,
          lineText: "  @ayme.action get total() {",
        },
      ],
      "/app/ayme/pom/Basket.ts"
    )
  ).toEqual([
    {
      text: "No tsconfig.json reaches the module.",
      location: { file: "/app/ayme/pom/Basket.ts" },
    },
    {
      text: "The tsconfig is not valid.",
      location: { file: "/app/ayme/tsconfig.json" },
    },
    {
      text: "@ayme.action needs a method.",
      location: {
        file: "/app/ayme/pom/Basket.ts",
        line: 4,
        // TypeScript counts from 1, esbuild from 0, in UTF-8 bytes.
        column: 2,
        lineText: "  @ayme.action get total() {",
      },
    },
  ]);
});

it("counts a column in the UTF-8 bytes before it, as esbuild does", () => {
  expect(
    compileErrors(
      [
        {
          text: "Wrong.",
          file: "/app/a.ts",
          line: 1,
          column: 5,
          lineText: "é = 1;",
        },
      ],
      "/app/a.ts"
    )[0]!.location
  ).toMatchObject({ column: 5 });
});
