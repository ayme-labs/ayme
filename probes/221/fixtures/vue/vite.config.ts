import { defineConfig } from "vite";
import { ayme } from "@ayme-dev/unplugin-ayme/vite";
export default defineConfig({
  plugins: [ayme({ inspector: false })],
  build: { minify: false },
  define: {
    __VUE_OPTIONS_API__: "true",
    __VUE_PROD_DEVTOOLS__: "false",
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "true",
  },
});
