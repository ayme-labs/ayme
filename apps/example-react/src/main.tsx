import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AymeWebMcpProvider,
  useAymeWebMcp,
  usePageObject,
} from "@ayme-dev/react";
import { CounterPage } from "../playwright/pom/CounterPage";
import "./style.css";

function Counter() {
  const [count, setCount] = useState(0);
  const pom = usePageObject(CounterPage);
  return (
    <section aria-label="Counter">
      <p>
        Count: <output>{count}</output>
      </p>
      <button onClick={() => setCount((value) => value + 1)}>Increment</button>
      <button onClick={() => void pom.increment()}>Call Page Object</button>
    </section>
  );
}

function App() {
  const { publicationStatus, retryPublication } = useAymeWebMcp();
  const [visible, setVisible] = useState(true);
  return (
    <main>
      <h1>React integration check</h1>
      <p>One Page Object, direct calls, and Page Object Tools.</p>
      <p role="status" aria-label="Publication">
        Publication: {publicationStatus.state}
      </p>
      <button onClick={() => void retryPublication()}>Retry publication</button>
      <button onClick={() => setVisible((value) => !value)}>
        {visible ? "Unmount counter" : "Mount counter"}
      </button>
      {visible && <Counter />}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AymeWebMcpProvider>
      <App />
    </AymeWebMcpProvider>
  </StrictMode>
);
