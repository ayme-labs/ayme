// `VITE_AYME_SSR=off` runs the example in SvelteKit's SPA mode, with no
// server rendering.
export const ssr = import.meta.env.VITE_AYME_SSR !== "off";
