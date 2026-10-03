<script>
  import { usePageObject } from "../index";

  export let model;
  export let onInit = () => {};

  onInit(usePageObject(model));
</script>
