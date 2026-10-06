"use client";

import { useState } from "react";
import { useAyme, usePageObject, usePeek } from "@ayme-dev/react";
import { CounterPage } from "../playwright/pom/CounterPage";
import { SubCounterPage } from "../playwright/pom/SubCounterPage";

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

export default function CounterExample() {
  const [visible, setVisible] = useState(true);
  const { webMCP } = useAyme();
  return (
    <>
      <p role="status" aria-label="Publication">
        Publication: {webMCP.publicationStatus.state}
      </p>
      <button onClick={() => setVisible((value) => !value)}>
        {visible ? "Unmount counter" : "Mount counter"}
      </button>
      {visible && <Counter />}
    </>
  );
}
