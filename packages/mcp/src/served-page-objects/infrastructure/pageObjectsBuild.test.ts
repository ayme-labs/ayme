import { expect, it } from "vitest";

import { PageObjectsBuildError } from "../domain/buildFailure";
import { failedPageObjects, type PageObjectsBuild } from "./pageObjectsBuild";

const entry = "/project/.ayme/page-objects.ts";

const buildWith = (modules: PageObjectsBuild["modules"]) =>
  Promise.resolve<PageObjectsBuild>({
    modules,
    onBuilt: () => () => {},
    close: async () => {},
  });

it("gives the first error of a build of the entry that has never succeeded", async () => {
  const failing = buildWith(async () => {
    throw new PageObjectsBuildError({
      entry,
      lastGood: false,
      errors: [
        {
          text: "Unexpected end of file",
          location: {
            file: "/project/.ayme/pom/PlainPage.ts",
            line: 22,
            column: 0,
          },
        },
        { text: "Second error", location: null },
      ],
    });
  });

  expect(await failedPageObjects(entry, failing)).toEqual({
    entry,
    error: "/project/.ayme/pom/PlainPage.ts:22:0: Unexpected end of file",
  });
});

it("gives why the build could not start", async () => {
  const unstarted = Promise.reject<PageObjectsBuild>(
    new Error("needs @ayme-dev/ayme/compiler, which does not resolve")
  );

  expect(await failedPageObjects(entry, unstarted)).toEqual({
    entry,
    error: "needs @ayme-dev/ayme/compiler, which does not resolve",
  });
});

it("gives nothing once a build has succeeded", async () => {
  expect(
    await failedPageObjects(
      entry,
      buildWith(async () => new Map())
    )
  ).toBeUndefined();
});
