import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

// Reading a zip archive, such as a trace, with Node alone: the machines the
// tests run on do not all have an `unzip` command.
// Test-only: only tests import this folder (docs/testing.md#test-only-code).

/** The four bytes that start the record at the end of a zip archive. */
const END_OF_ARCHIVE = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

/**
 * The text of the file called `name` in the zip archive at `file`. Reads the
 * archive's list of files at its end, as a zip reader does; an archive of
 * 4 GB or more is beyond it.
 */
export async function zipText(file: string, name: string): Promise<string> {
  const zip = await readFile(file);
  const end = zip.lastIndexOf(END_OF_ARCHIVE);
  if (end < 0) throw new Error(`${file} is not a zip archive.`);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let entry = 0; entry < count; entry += 1) {
    const nameLength = zip.readUInt16LE(at + 28);
    if (zip.toString("utf8", at + 46, at + 46 + nameLength) === name) {
      // The file's own record: its name and extra field, then its bytes.
      const record = zip.readUInt32LE(at + 42);
      const start =
        record +
        30 +
        zip.readUInt16LE(record + 26) +
        zip.readUInt16LE(record + 28);
      const bytes = zip.subarray(start, start + zip.readUInt32LE(at + 20));
      // Method 0 stores the bytes as they are; 8 deflates them.
      const stored = zip.readUInt16LE(at + 10) === 0;
      return (stored ? bytes : inflateRawSync(bytes)).toString("utf8");
    }
    at +=
      46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  throw new Error(`${file} has no file called ${name}.`);
}
