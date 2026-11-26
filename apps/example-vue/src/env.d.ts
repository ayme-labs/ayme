/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";

  const component: DefineComponent<
    Record<string, never>,
    Record<string, never>,
    unknown
  >;
  export default component;
}

declare global {
  interface ImportMetaEnv {
    /** Whether the dev server mounted the Decision Endpoint; set by
     *  `vite.config.ts`. */
    readonly AYME_DECISION_ENDPOINT?: boolean;
  }

  interface Window {
    __AYME_VUE_ACTIONS__: string[];
  }
}

export {};
