<script>
  import { useAyme } from "../index";

  const {
    webMCP: { publicationStatus },
  } = useAyme();
</script>

<p>{$publicationStatus.state}</p>
