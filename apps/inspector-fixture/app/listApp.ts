import { startAyme } from "./startAyme";

/**
 * Sets up the list app on the fixture page, then starts ayme on it, with a
 * Peek of the list. Returns what stops ayme.
 */
export function startListApp(options: Parameters<typeof startAyme>[0] = {}) {
  const input = document.querySelector("input")!;
  const list = document.querySelector("ul")!;
  const [addButton, clearButton] = document.querySelectorAll("button");
  clearButton!.addEventListener("click", () => list.replaceChildren());
  // A shortcut on the document, which a key reaches wherever focus is, so
  // press_key run from the panel has something to press.
  document.addEventListener("keydown", (event) => {
    if (event.key === "F2") input.value = "";
  });
  addButton!.addEventListener("click", () => {
    const item = document.createElement("li");
    item.textContent = input.value;
    list.append(item);
    input.value = "";
  });

  const stop = startAyme(options);
  // A Peek of the list, which the Tools lens lists under Peek tools.
  const removePeek = window.fixtureAyme?.peek(
    () => ({ items: [...list.children].map((item) => item.textContent) }),
    "list"
  );
  return () => {
    removePeek?.();
    stop?.();
  };
}
