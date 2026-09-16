import { defineConfig } from "tsdown";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts", "src/demo.ts"],
  format: ["esm"],
  plugins: [vue()],
});
