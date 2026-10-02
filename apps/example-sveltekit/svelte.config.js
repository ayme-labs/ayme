import process from "node:process";
import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const spa = process.env.VITE_AYME_SSR === "off";

/** @type {import("@sveltejs/kit").Config} */
export default {
  preprocess: vitePreprocess(),
  kit: { adapter: adapter({ out: spa ? "build-spa" : "build" }) },
};
