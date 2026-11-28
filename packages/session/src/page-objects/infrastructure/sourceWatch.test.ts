import {
  chmod,
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

/** Whether `watch` tells of an edit within `ms`. */
const toldWithin = (watch: ReturnType<typeof sourceWatch>, ms: number) =>
  Effect.runPromise(
    Stream.runHead(watch.edits).pipe(
      Effect.timeoutOption(ms),
      Effect.map((told) => told._tag === "Some")
    )
  );

/** Waits `ms`. */
const after = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

it("tells a listener that comes later of an edit made since the last build began, and of none from before it", async () => {
  const dir = await folder({ "Basket.ts": "export class Basket {}\n" });
  const told: string[] = [];
  const watch = sourceWatch({
    checked: (edit) => told.push(`checked: ${edit}`),
  });
  onTestFinished(watch.close);
  watch.began();
  watch.reads(join(dir, "Basket.ts"));
  watch.finished(false);
  const first = firstEdit(watch);
  await writeFile(join(dir, "Basket.ts"), "export class Basket { a = 1 }\n");
  await first;
  await expect(firstEdit(watch)).resolves.toBeDefined();

  watch.began();
  told.length = 0;
  const later = firstEdit(watch).then(() => told.push("told"));
  await writeFile(join(dir, "Basket.ts"), "export class Basket { a = 2 }\n");
  await later;

  expect(told).toEqual(["checked: true", "told"]);
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

/** A watch on `files`, with its checks for edits as they end, each with
 * whether it found one. */
function checkedWatch(files: readonly string[], failed = false) {
  const checks: boolean[] = [];
  const waiting: (() => void)[] = [];
  const watch = sourceWatch({
    quietMs: 200,
    checked: (edit) => {
      checks.push(edit);
      waiting.splice(0).forEach((resolve) => resolve());
    },
  });
  onTestFinished(watch.close);
  watch.began();
  for (const file of files) watch.reads(file);
  watch.finished(failed);
  return {
    watch,
    checks,
    /** Resolves once the next check ends. */
    nextCheck: () => new Promise<void>((resolve) => waiting.push(resolve)),
  };
}

it("a burst of writes, as a save and a formatter's write after it, is one edit, told once the source was quiet", async () => {
  const dir = await folder({ "Basket.ts": "export class Basket {}\n" });
  const { checks, nextCheck } = checkedWatch([join(dir, "Basket.ts")]);
  await nextCheck();
  const checked = nextCheck();

  await writeFile(join(dir, "Basket.ts"), "export class Basket {a=1}\n");
  await new Promise((resolve) => setTimeout(resolve, 20));
  await writeFile(join(dir, "Basket.ts"), "export class Basket { a = 1 }\n");
  await checked;
  await new Promise((resolve) => setTimeout(resolve, 400));

  expect(checks).toEqual([false, true]);
});

it("a write that leaves every input as the build read it is no edit, also after a failed build", async () => {
  const dir = await folder({ "Basket.ts": "export class Basket {}\n" });
  const { watch, checks, nextCheck } = checkedWatch(
    [join(dir, "Basket.ts")],
    true
  );
  await nextCheck();
  const checked = nextCheck();

  await writeFile(join(dir, "Basket.ts"), "export class Basket {}\n");
  await writeFile(join(dir, "Basket.js"), "// built beside its source\n");
  await checked;

  expect(checks).toEqual([false, false]);
  expect(await toldWithin(watch, 50)).toBe(false);
});

it("a build that succeeded watches only what it read: a file only an earlier build read is no input any more", async () => {
  const dir = await folder({
    "Basket.ts": "export class Basket {}\n",
    "Cart.ts": "export class Cart {}\n",
  });
  const { watch, checks, nextCheck } = checkedWatch([
    join(dir, "Basket.ts"),
    join(dir, "Cart.ts"),
  ]);
  await nextCheck();
  watch.began();
  watch.reads(join(dir, "Basket.ts"));
  watch.finished(false);
  await nextCheck();
  const checked = nextCheck();

  await writeFile(join(dir, "Cart.ts"), "export class Cart { a = 1 }\n");
  await checked;

  expect(checks).toEqual([false, false, false]);
});

it("a file written after its build began is an edit, also when the build read it after the write, since the build may have read it before", async () => {
  const dir = await folder({ "Basket.ts": "export class Basket {}\n" });
  const watch = sourceWatch();
  onTestFinished(watch.close);
  watch.began();
  await after(5);
  await writeFile(join(dir, "Basket.ts"), "export class Basket { a = 1 }\n");
  watch.reads(join(dir, "Basket.ts"));

  watch.finished(false);

  expect(await toldWithin(watch, 2000)).toBe(true);
});

it("a file whose folder does not exist either is watched from the nearest folder that does, told once it appears, and again at its next write before a build", async () => {
  const dir = await folder({});
  const cart = join(dir, "pom", "cart", "Cart.ts");
  const watch = watching([cart], true);
  expect(watch.lost()).toBeUndefined();

  const appeared = firstEdit(watch);
  await mkdir(join(dir, "pom", "cart"), { recursive: true });
  await writeFile(cart, "export class Cart {}\n");
  await appeared;
  await after(300);

  const written = firstEdit(watch);
  await writeFile(cart, "export class Cart { a = 1 }\n");
  await expect(written).resolves.toBeDefined();
});

it("a closed watch checks nothing more: neither the check it had coming nor a write after it, after several builds", async () => {
  const dir = await folder({ "Basket.ts": "export class Basket {}\n" });
  const { watch, checks, nextCheck } = checkedWatch([join(dir, "Basket.ts")]);
  await nextCheck();
  watch.began();
  watch.reads(join(dir, "Basket.ts"));
  watch.finished(false);

  watch.close();
  await writeFile(join(dir, "Basket.ts"), "export class Basket { a = 1 }\n");
  await after(400);

  expect(checks).toEqual([false]);
});

it("a folder put in place of a watched one, as on a branch switch, is watched from the next build on", async () => {
  const dir = await folder({});
  await mkdir(join(dir, "pom"));
  const basket = join(dir, "pom", "Basket.ts");
  await writeFile(basket, "export class Basket {}\n");
  const watch = watching([basket]);
  await after(150);

  const switched = firstEdit(watch);
  await rename(join(dir, "pom"), join(dir, "pom-before"));
  await mkdir(join(dir, "pom"));
  await writeFile(basket, "export class Basket { a = 1 }\n");
  await switched;
  watch.began();
  watch.reads(basket);
  watch.finished(false);
  await after(300);

  const edited = firstEdit(watch);
  await writeFile(basket, "export class Basket { a = 2 }\n");
  await expect(edited).resolves.toBeDefined();
});

// Root reads every folder, so only another user is refused one.
it.skipIf(process.getuid?.() === 0)(
  "a folder that cannot be watched is told, with why, until a build finds it can be",
  async () => {
    const dir = await folder({});
    const locked = join(dir, "pom");
    await mkdir(locked);
    await writeFile(join(locked, "Basket.ts"), "export class Basket {}\n");
    await chmod(locked, 0o000);
    onTestFinished(() => chmod(locked, 0o755));

    const watch = watching([join(locked, "Basket.ts")]);
    expect(watch.lost()).toBe(
      `${locked}: EACCES: permission denied, watch '${locked}'`
    );

    await chmod(locked, 0o755);
    watch.began();
    watch.reads(join(locked, "Basket.ts"));
    watch.finished(false);
    expect(watch.lost()).toBeUndefined();
  }
);
