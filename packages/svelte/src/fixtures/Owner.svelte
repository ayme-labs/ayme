<script>
  import { useAyme } from "../index";

  export let options = undefined;
  export let onInit = () => {};
  export let child = undefined;
  export let childProps = {};
  export let shown = true;

  onInit(useAyme(options));
</script>

{#if child && shown}<svelte:component this={child} {...childProps} />{/if}
