import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { startAyme } from "./startAyme";

// The host's own React, separate from the one bundled into the Inspector,
// under StrictMode, which mounts every effect twice.
function App() {
  const [draft, setDraft] = useState("");
  const [items, setItems] = useState<string[]>([]);
  useEffect(() => startAyme(), []);
  return (
    <main>
      <h1>Groceries</h1>
      <label>
        New item{" "}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <button
        type="button"
        onClick={() => {
          setItems((current) => [...current, draft]);
          setDraft("");
        }}
      >
        Add item
      </button>
      <ul aria-label="Items">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </main>
  );
}

createRoot(document.querySelector("#app")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
