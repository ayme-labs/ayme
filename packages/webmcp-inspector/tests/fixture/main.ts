import { startAyme } from "./startAyme";

const input = document.querySelector("input")!;
const list = document.querySelector("ul")!;
document.querySelector("button")!.addEventListener("click", () => {
  const item = document.createElement("li");
  item.textContent = input.value;
  list.append(item);
  input.value = "";
});

startAyme();
