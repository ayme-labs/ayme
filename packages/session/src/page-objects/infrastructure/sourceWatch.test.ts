import {
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Stream } from "effect";
import { expect, it, onTestFinished } from "vitest";

import { sourceWatch } from "./sourceWatch";

/** A folder of the test's own with `files` in it. */
async function folder(files: Record<string, string>) {
  const made = await realpath(await mkdtemp(join(tmpdir(), "ayme-watch-")));
  onTestFinished(() => rm(made, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files))
    await writeFile(join(made, name), text);
  return made;
}

/** A watch on `files`, as a build that read them leaves it. */
function watching(files: readonly string[], failed = false) {
  const watch = sourceWatch();
  onTestFinished(watch.close);
  watch.began();
  for (const file of files) watch.reads(file);
  watch.finished(failed);
  return watch;
}

/** The first edit `watch` tells of, once it does. */
const firstEdit = (watch: ReturnType<typeof sourceWatch>) =>
  Effect.runPromise(Stream.runHead(watch.edits));

it("tells of an edit to a file the last build read, also one an editor saves by renaming a new file over it", async () => {
  const dir = await folder({ "Basket.ts": "export class Basket {}\n" });
  const watch = watching([join(dir, "Basket.ts")]);

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
  const watch = watching([join(dir, "Basket.ts")]);
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

it("tells of an edit made after a build read a file and before the watch reached it", async () => {
  const dir = await folder({ "Basket.ts": "export class Basket {}\n" });
  const watch = sourceWatch();
  onTestFinished(watch.close);
  watch.began();
  watch.reads(join(dir, "Basket.ts"));
  await writeFile(join(dir, "Basket.ts"), "export class Basket { a = 1 }\n");

  watch.finished(false);

  await expect(firstEdit(watch)).resolves.toBeDefined();
});

it("a failed build keeps what the last one read watched, and the file a failed import names is watched where its folder would be", async () => {
  const dir = await folder({ "Basket.ts": "export class Basket {}\n" });
  const watch = watching([join(dir, "Basket.ts")]);
  watch.began();
  watch.reads(join(dir, "cart", "Cart.ts"));
  watch.finished(true);

  const repaired = firstEdit(watch);
  await mkdir(join(dir, "cart"));
  await writeFile(join(dir, "cart", "Cart.ts"), "export class Cart {}\n");
  await expect(repaired).resolves.toBeDefined();

  watch.began();
  watch.reads(join(dir, "cart", "Cart.ts"));
  watch.finished(true);
  const edited = firstEdit(watch);
  await writeFile(join(dir, "Basket.ts"), "export class Basket { a = 1 }\n");
  await expect(edited).resolves.toBeDefined();
});
