import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AymeProvider, useAyme, usePageObject, usePeek } from "@ayme-dev/react";
import { CounterPage } from "../playwright/pom/CounterPage";
import { SubCounterPage } from "../playwright/pom/SubCounterPage";
import "./style.css";

function Counter() {
  const [count, setCount] = useState(0);
  const pom = usePageObject(CounterPage);
  usePageObject(SubCounterPage);
  usePeek({ count }, "counter");
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

// A second page, which the browser loads as a new document: the app has no
// client router.
function OtherPage() {
  return (
    <main>
      <h1>React integration check</h1>
      <p>Other page without Page Objects.</p>
    </main>
  );
}

function App() {
  const { webMCP } = useAyme();
  const [visible, setVisible] = useState(true);
  return (
    <main>
      <h1>React integration check</h1>
      <p>One Page Object, direct calls, and Page Object Tools.</p>
      <p role="status" aria-label="Publication">
        Publication: {webMCP.publicationStatus.state}
      </p>
      <button onClick={() => void webMCP.retryPublication()}>
        Retry publication
      </button>
      <button onClick={() => setVisible((value) => !value)}>
        {visible ? "Unmount counter" : "Mount counter"}
      </button>
      {visible && <Counter />}
      <a href="/other">Full page load</a>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AymeProvider
      webMCP={{ enabled: true }}
      inspector={import.meta.env.MODE !== "inspector-disabled"}
      agentConnection={import.meta.env.MODE !== "inspector-disabled"}
    >
      {location.pathname === "/other" ? <OtherPage /> : <App />}
    </AymeProvider>
  </StrictMode>
);
