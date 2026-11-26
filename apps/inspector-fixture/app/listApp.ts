import { startAyme } from "./startAyme";

/**
 * Sets up the list app on the fixture page, then starts ayme on it. Returns
 * what stops ayme.
 */
export function startListApp(options: Parameters<typeof startAyme>[0] = {}) {
  const input = document.querySelector("input")!;
  const list = document.querySelector("ul")!;
  const [addButton, clearButton] = document.querySelectorAll("button");
  clearButton!.addEventListener("click", () => list.replaceChildren());
  // A function key pressed anywhere writes its name into the New item
  // field: a key reaches the document wherever focus is, so press_key run
  // from the panel has something to press, and the page shows which key.
  document.addEventListener("keydown", (event) => {
    if (/^F\d+$/.test(event.key)) input.value = event.key;
  });
  addButton!.addEventListener("click", () => {
    const item = document.createElement("li");
    item.textContent = input.value;
    list.append(item);
    input.value = "";
  });

  return startAyme(options);
}
