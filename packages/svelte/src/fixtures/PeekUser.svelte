<script>
  import { peek } from "../index";

  export let count = 0;
  export let id = undefined;

  peek(() => ({ count }), "counter", id);
</script>
