"use client";

import { useState, useSyncExternalStore } from "react";
import {
  AymeWebMcpProvider,
  useAymeWebMcp,
  usePageObject,
} from "@ayme-dev/webmcp-react";
import {
  listRegisteredPoms,
  subscribeToRegisteredPoms,
} from "@ayme-dev/webmcp/internal";
import { CounterPage } from "../playwright/pom/CounterPage";
import { SubCounterPage } from "../playwright/pom/SubCounterPage";

function compiledMetadataSnapshot() {
  return JSON.stringify(
    listRegisteredPoms().flatMap(({ manifest }) => manifest.tools)
  );
}

function CompiledMetadata() {
  const metadata = useSyncExternalStore(
    subscribeToRegisteredPoms,
    compiledMetadataSnapshot,
    () => "[]"
  );
  return <pre data-testid="compiled-metadata">{metadata}</pre>;
}

function Counter() {
  const [count, setCount] = useState(0);
  const pom = usePageObject(CounterPage);
  usePageObject(SubCounterPage);
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

function Demo() {
  const [visible, setVisible] = useState(true);
  const { publicationStatus } = useAymeWebMcp();
  return (
    <>
      <p role="status" aria-label="Publication">
        Publication: {publicationStatus.state}
      </p>
      <button onClick={() => setVisible((value) => !value)}>
        {visible ? "Unmount counter" : "Mount counter"}
      </button>
      {visible && <Counter />}
      <CompiledMetadata />
    </>
  );
}

export default function CounterExample() {
  return (
    <AymeWebMcpProvider>
      <Demo />
    </AymeWebMcpProvider>
  );
}
