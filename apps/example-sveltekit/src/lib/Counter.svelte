<script lang="ts">
  import { onMount } from "svelte";
  import { useAyme, usePageObject } from "@ayme-dev/svelte";
  import { CounterPage } from "$lib/pom/CounterPage";
  import { SubCounterPage } from "$lib/pom/SubCounterPage";

  const { ayme } = useAyme();
  const pom = usePageObject(CounterPage);
  usePageObject(SubCounterPage);
  let count = $state(0);
  let runtimeAtMount = $state("pending");

  // A stopped runtime rejects pursueGoal before it checks for a goalLoop, so
  // this error shows the runtime had started before this component mounted.
  onMount(() => {
    ayme.pursueGoal("Check the runtime", { maxSteps: 1 }).catch(
      (error: Error) => {
        runtimeAtMount = error.message.includes("goalLoop")
          ? "started"
          : "stopped";
      }
    );
  });
</script>

<section aria-label="Counter">
  <p>Count: <output>{count}</output></p>
  <button onclick={() => (count += 1)}>Increment</button>
  <button onclick={() => pom.increment()}>Call Page Object</button>
  <p data-testid="started">Runtime at child mount: {runtimeAtMount}</p>
</section>
