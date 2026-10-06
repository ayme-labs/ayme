// How often the server rendered the home page, for the server's Peek
// `renders`. Kept on globalThis: Next.js loads this module in more than one
// server bundle, the page's and `instrumentation.ts`'s, and they must count
// the same renders.
const renders = ((
  globalThis as typeof globalThis & { __exampleRenders?: { count: number } }
).__exampleRenders ??= { count: 0 });

export function countRender() {
  renders.count += 1;
}

export function renderCount() {
  return renders.count;
}
