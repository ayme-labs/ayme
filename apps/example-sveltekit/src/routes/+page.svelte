<script lang="ts">
  import Counter from "$lib/Counter.svelte";

  let mounted = $state(true);
</script>

<a href="/other" data-sveltekit-reload>Full page load</a>

{#if mounted}
  <Counter />
  <button onclick={() => (mounted = false)}>Unmount counter</button>
{:else}
  <button onclick={() => (mounted = true)}>Mount counter</button>
{/if}
