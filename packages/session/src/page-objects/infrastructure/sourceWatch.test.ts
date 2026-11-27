import { mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Stream } from "effect";
import { expect, it, onTestFinished } from "vitest";

import { isEdit, sourceWatch } from "./sourceWatch";

const read = new Set(["/app/ayme/page-objects.ts", "/app/ayme/pom/Basket.ts"]);

it("after a good build, only a change to a file it read is an edit", () => {
  expect(isEdit("/app/ayme/pom/Basket.ts", { read, failed: false })).toBe(true);
  expect(isEdit("/app/ayme/pom/notes.md", { read, failed: false })).toBe(false);
});

it("after a failed build, any change in a folder it read from is an edit, since the file that fixes it may be new", () => {
  expect(isEdit("/app/ayme/pom/Cart.ts", { read, failed: true })).toBe(true);
});

it("a change the system does not name is an edit", () => {
  expect(isEdit(undefined, { read, failed: false })).toBe(true);
});

/** A folder of the test's own with `files` in it. */
async function folder(files: Record<string, string>) {
  const made = await realpath(await mkdtemp(join(tmpdir(), "ayme-watch-")));
  onTestFinished(() => rm(made, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files))
    await writeFile(join(made, name), text);
  return made;
}

/** The first edit `watch` tells of, once it does. */
const firstEdit = (watch: ReturnType<typeof sourceWatch>) =>
  Effect.runPromise(Stream.runHead(watch.edits));

it("tells of an edit to a file the last build read, also one an editor saves by renaming a new file over it", async () => {
  const dir = await folder({ "Basket.ts": "export class Basket {}\n" });
  const watch = sourceWatch();
  onTestFinished(watch.close);
  watch.finished(new Set([join(dir, "Basket.ts")]), false);

  const edited = firstEdit(watch);
  await writeFile(
    join(dir, "Basket.ts.tmp"),
    "export class Basket { a = 1 }\n"
  );
  await rename(join(dir, "Basket.ts.tmp"), join(dir, "Basket.ts"));

  await expect(edited).resolves.toBeDefined();
});

it("tells a listener that comes later of an edit made since the last build began", async () => {
  const dir = await folder({ "Basket.ts": "export class Basket {}\n" });
  const watch = sourceWatch();
  onTestFinished(watch.close);
  watch.finished(new Set([join(dir, "Basket.ts")]), false);
  const first = firstEdit(watch);
  await writeFile(join(dir, "Basket.ts"), "export class Basket { a = 1 }\n");
  await first;

  await expect(firstEdit(watch)).resolves.toBeDefined();
  watch.began();
  const none = await Effect.runPromise(
    Stream.runHead(watch.edits).pipe(Effect.timeoutOption(0))
  );
  expect(none._tag).toBe("None");
});
