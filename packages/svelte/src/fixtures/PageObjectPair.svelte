<script>
  import PageObjectUser from "./PageObjectUser.svelte";

  export let model;
  export let showFirst = true;
  export let showSecond = true;
  export let onInit = () => {};
</script>

{#if showFirst}<PageObjectUser {model} {onInit} />{/if}
{#if showSecond}<PageObjectUser {model} {onInit} />{/if}
