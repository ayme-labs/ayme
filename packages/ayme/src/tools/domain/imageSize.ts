/**
 * An image's size in pixels, read from its header bytes, for the formats the
 * screenshot tool produces. No decoder is needed, so it reads the same in
 * Node and in the browser. Throws for bytes that are not that format.
 */
export function imageSizeOf(
  bytes: Uint8Array,
  mimeType: "image/png" | "image/jpeg"
): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mimeType === "image/png") {
    // The 8-byte signature, then the IHDR chunk: its length and name, and
    // the width and the height as 32-bit big-endian numbers.
    if (bytes.length < 24 || view.getUint32(0) !== 0x89504e47)
      throw new Error("The screenshot is not a PNG.");
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length < 2 || view.getUint16(0) !== 0xffd8)
    throw new Error("The screenshot is not a JPEG.");
  // Segments of a marker and a length, up to the frame header (SOF0 to SOF15
  // but the tables and the arithmetic-coding marker), which holds the height
  // and the width as 16-bit big-endian numbers after the sample precision.
  for (let at = 2; at + 9 <= bytes.length;) {
    if (view.getUint8(at) !== 0xff) break;
    const marker = view.getUint8(at + 1);
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    )
      return { width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
    at += 2 + view.getUint16(at + 2);
  }
  throw new Error("The JPEG screenshot has no frame header.");
}
