// How often the server rendered the home page, for the server's Peek
// `renders` in `server-peeks.ts`.
let renders = 0;

export function countRender() {
  renders += 1;
}

export function renderCount() {
  return renders;
}
