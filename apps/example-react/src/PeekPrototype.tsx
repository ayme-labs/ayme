import { useRef, useState } from "react";
import { ayme } from "@ayme-dev/webmcp";
import { AymeWebMcpProvider, usePeek } from "@ayme-dev/webmcp-react";

const ignoreSnapshot = (element: Element) =>
  element.matches("[data-peek-snapshot]");

function Counter({ label }: { label: string }) {
  const [count, setCount] = useState(0);
  const evaluations = useRef(0);
  usePeek(() => ({ count, evaluations: ++evaluations.current }), label);
  return (
    <section aria-label={label}>
      <p>
        {label}: <output>{count}</output>
      </p>
      <button onClick={() => setCount((value) => value + 1)}>
        Increment {label}
      </button>
    </section>
  );
}

function Counters() {
  const [mounted, setMounted] = useState(
    () => !new URLSearchParams(location.search).has("empty")
  );
  const [visible, setVisible] = useState(true);
  if (!mounted)
    return <button onClick={() => setMounted(true)}>Mount first peeks</button>;
  return (
    <>
      <Counter label="A" />
      {visible && <Counter label="B" />}
      <button onClick={() => setVisible((value) => !value)}>
        {visible ? "Unmount B" : "Remount B"}
      </button>
    </>
  );
}

export function PeekPrototype() {
  const [running, setRunning] = useState(true);
  const [snapshot, setSnapshot] = useState("No snapshot requested.");
  return (
    <main>
      <h1>Throwaway peek prototype</h1>
      <p>
        Can two React instances expose independent latest committed state on
        demand, and clean up on unmount?
      </p>
      <p>
        Temporary usePeek getter hook. Normal hook order applies. Synchronous
        counter values only. No shorthand transform, source labels, stores, or
        log events.
      </p>
      <button onClick={() => setRunning((value) => !value)}>
        {running ? "Stop provider" : "Start provider"}
      </button>
      <p>
        In the inspector's Tools tab, select peek and run with no id to discover
        live IDs. Then enter one ID and run again to read only that counter.
        Discovery does not evaluate getters.
      </p>
      {running && (
        <AymeWebMcpProvider ignore={ignoreSnapshot}>
          <Counters />
        </AymeWebMcpProvider>
      )}
      <button
        disabled={!running}
        onClick={() =>
          void ayme.getPageContext().then((context) =>
            setSnapshot(
              JSON.stringify(
                {
                  prototypePeeks: context.prototypePeeks ?? [],
                  structure: context.structure,
                  pomDefinitions: context.pomDefinitions,
                },
                null,
                2
              )
            )
          )
        }
      >
        Snapshot get_page_context
      </button>
      <p>
        Snapshot stays fixed until requested again. Labels are not identities.
        The evaluations field counts demand reads, starting at one on the first
        snapshot.
      </p>
      <pre
        aria-label="Peek snapshot"
        data-peek-snapshot
        style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
      >
        {snapshot}
      </pre>
    </main>
  );
}
