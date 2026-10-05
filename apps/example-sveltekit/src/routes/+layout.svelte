<script lang="ts">
  import type { Snippet } from "svelte";
  import { dev } from "$app/environment";
  import { useAyme } from "@ayme-dev/svelte";

  let { children }: { children: Snippet } = $props();

  // The root layout owns the runtime: SvelteKit never swaps it on navigation.
  const {
    webMCP: { publicationStatus },
  } = useAyme({
    webMCP: { enabled: true },
    inspector: dev,
    agentConnection: dev,
  });
</script>

<h1>Ayme SvelteKit example</h1>
<nav>
  <a href="/">Home</a>
  <a href="/other">Other</a>
</nav>
<p role="status" aria-label="Publication">
  Publication: {$publicationStatus.state}
</p>

{@render children()}
