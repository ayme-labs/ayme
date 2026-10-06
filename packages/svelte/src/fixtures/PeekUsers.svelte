<script>
  import PeekUser from "./PeekUser.svelte";

  export let counts = [];
</script>

{#each counts as count}<PeekUser {count} />{/each}
