import { createApp, createSSRApp } from "vue";
import { Root } from "./App";
const el = document.getElementById("root")!;
(el.hasChildNodes() ? createSSRApp(Root) : createApp(Root)).mount(el);
