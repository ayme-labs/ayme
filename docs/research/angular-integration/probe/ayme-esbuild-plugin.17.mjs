// Angular 17.1's custom-esbuild accepts plugin paths only, without options.
import aymeAngularPlugin from "./ayme-esbuild-plugin.mjs";
export default aymeAngularPlugin({
  tsconfigPath: "tsconfig.pom.json",
  define: { __AYME_WEBMCP_PUBLISH__: "true" },
});
