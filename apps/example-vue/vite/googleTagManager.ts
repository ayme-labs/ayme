import type { Plugin } from "vite";

const containerIdPattern = /^GTM-[A-Z0-9]+$/;

/**
 * Loads the Google Tag Manager container `containerId` in the built page, as
 * ayme.dev's landing does: consent and GA4 are configured inside the
 * container. Without an ID, as in the dev server, the tests and the `/ayme/`
 * Pages build, the page loads no tag.
 */
export function googleTagManager(containerId: string | undefined): Plugin {
  return {
    name: "example-vue-google-tag-manager",
    apply: "build",
    transformIndexHtml() {
      if (!containerId) return;
      // The ID lands inside a script, so anything but a container ID is a
      // misconfiguration, not something to escape.
      if (!containerIdPattern.test(containerId))
        throw new Error(
          `VITE_GTM_ID is not a GTM container ID: ${containerId}`
        );
      return [
        {
          tag: "script",
          injectTo: "head-prepend",
          children: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${containerId}');`,
        },
        {
          tag: "noscript",
          injectTo: "body-prepend",
          children: `<iframe src="https://www.googletagmanager.com/ns.html?id=${containerId}" height="0" width="0" style="display:none;visibility:hidden"></iframe>`,
        },
      ];
    },
  };
}
