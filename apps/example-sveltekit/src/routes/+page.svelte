<script lang="ts">
  import Counter from "$lib/Counter.svelte";

  let mounted = $state(true);
</script>

{#if mounted}
  <Counter />
  <button onclick={() => (mounted = false)}>Unmount counter</button>
{:else}
  <button onclick={() => (mounted = true)}>Mount counter</button>
{/if}
