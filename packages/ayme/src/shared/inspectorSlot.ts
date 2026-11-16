import type { InspectorContract, InspectorObserver } from "./inspectorContract";

/**
 * Where the browser runtime publishes its Inspector contract (ADR-0049): a
 * slot on the document's global, like the in-page module's, so the inline
 * Inspector reaches the runtime's contract without importing the runtime.
 */
const slotKey = Symbol.for("ayme.inspectorContract");

type Slot = {
  contract?: InspectorContract;
  /** Callers waiting for a contract to be published. */
  readonly waiting: Set<(contract: InspectorContract) => void>;
};

function slot(): Slot {
  const holder = globalThis as { [slotKey]?: Slot };
  return (holder[slotKey] ??= { waiting: new Set() });
}

/** The runtime: serves `contract` to the inline Inspector of this document. */
export function publishInspectorContract(contract: InspectorContract) {
  const published = slot();
  published.contract = contract;
  const waiting = [...published.waiting];
  published.waiting.clear();
  for (const resume of waiting) resume(contract);
}

/** Calls `use` with the published contract, now or once it is published. */
function whenPublished(use: (contract: InspectorContract) => void) {
  const published = slot();
  if (published.contract) {
    use(published.contract);
    return () => published.waiting.delete(use);
  }
  published.waiting.add(use);
  return () => published.waiting.delete(use);
}

function published(): Promise<InspectorContract> {
  return new Promise((resolve) => whenPublished(resolve));
}

/**
 * The contract of the runtime in this document, called directly, with no
 * serialization. Each call waits until the runtime has published it, so an
 * Inspector mounted before the session starts works.
 */
export function inlineInspectorContract(): InspectorContract {
  return {
    getState: async () => (await published()).getState(),
    subscribe(observer: InspectorObserver) {
      let stop: (() => void) | undefined;
      let stopped = false;
      const cancel = whenPublished((contract) => {
        if (!stopped) stop = contract.subscribe(observer);
      });
      return () => {
        stopped = true;
        cancel();
        stop?.();
      };
    },
    runTool: async (request) => (await published()).runTool(request),
    highlight: async (request) => (await published()).highlight(request),
    pick: async (request) => (await published()).pick(request),
    cancelPick: async (request) => (await published()).cancelPick(request),
    look: async () => (await published()).look(),
    recordedPageState: async () => (await published()).recordedPageState(),
    demo: async (request) => (await published()).demo(request),
    pomDefinitionText: async (request) =>
      (await published()).pomDefinitionText(request),
  };
}
