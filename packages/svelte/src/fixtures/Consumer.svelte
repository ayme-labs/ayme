<script>
  import { onMount } from "svelte";
  import { useAyme } from "../index";

  export let options = undefined;
  export let onInit = () => {};
  export let onMounted = () => {};

  const result = useAyme(options);
  onInit(result);
  onMount(() => onMounted(result));
</script>
