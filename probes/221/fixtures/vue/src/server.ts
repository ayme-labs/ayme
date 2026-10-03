import { createSSRApp } from "vue";
import { renderToString } from "@vue/server-renderer";
import { Root } from "./App";
export const render = () => renderToString(createSSRApp(Root));
