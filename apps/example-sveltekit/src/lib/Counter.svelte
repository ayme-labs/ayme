<script lang="ts">
  import { onMount } from "svelte";
  import { useAyme, usePageObject } from "@ayme-dev/svelte";
  import { CounterPage } from "$lib/pom/CounterPage";

  const { ayme } = useAyme();
  const pom = usePageObject(CounterPage);
  let count = $state(0);
  let runtimeAtMount = $state("pending");

  // A stopped runtime lists no tools, so a list shows the runtime had
  // started before this component mounted.
  onMount(() => {
    runtimeAtMount = ayme.tools.list().length > 0 ? "started" : "stopped";
  });
</script>

<section aria-label="Counter">
  <p>Count: <output>{count}</output></p>
  <button onclick={() => (count += 1)}>Increment</button>
  <button onclick={() => pom.increment()}>Call Page Object</button>
  <p data-testid="started">Runtime at child mount: {runtimeAtMount}</p>
</section>
