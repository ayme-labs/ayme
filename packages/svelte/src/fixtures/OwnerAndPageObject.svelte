<script>
  import { useAyme, usePageObject } from "../index";

  export let options = undefined;
  export let model;
  export let onInit = () => {};

  const result = useAyme(options);
  onInit({ ...result, pageObject: usePageObject(model) });
</script>
