import { startAyme } from "./startAyme";

/** Sets up the list app on the fixture page, then starts Ayme on it. */
export function startListApp({ publish = true } = {}) {
  const input = document.querySelector("input")!;
  const list = document.querySelector("ul")!;
  const [addButton, clearButton] = document.querySelectorAll("button");
  clearButton!.addEventListener("click", () => list.replaceChildren());
  addButton!.addEventListener("click", () => {
    const item = document.createElement("li");
    item.textContent = input.value;
    list.append(item);
    input.value = "";
  });

  startAyme({ publish });
}
