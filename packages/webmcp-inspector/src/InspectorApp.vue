<script setup lang="ts">
import { onScopeDispose, shallowRef } from "vue";

import DebugPanel from "./DebugPanel.vue";
import {
  getInspectorTrace,
  resetInspectorTrace,
  subscribeToInspectorTrace,
} from "./trace";
import { useInspector } from "./useInspector";

const trace = shallowRef(getInspectorTrace());
const unsubscribe = subscribeToInspectorTrace(() => {
  trace.value = getInspectorTrace();
});
onScopeDispose(unsubscribe);

const {
  pageState,
  pageStateCapturedAt,
  pageStateError,
  pageStateLoading,
  applicationModelSelectionPath,
  refreshPageState,
  refreshPomMembers,
  registeredPoms,
  previewApplicationModelTarget,
  clearApplicationModelPreview,
  pinApplicationModelTarget,
} = useInspector();

const inspectorStyles = `
  :host { all: initial; color: #172033; display: block; font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-size: 14px; inset: 0; pointer-events: none; position: fixed; z-index: 9; }
  *, *::before, *::after { box-sizing: border-box; }
  button, input, select, textarea { font: inherit; }
  button { background: #fff; border: 1px solid #b8c2d1; border-radius: .45rem; color: #24324a; cursor: pointer; padding: .45rem .65rem; }
  button:hover { background: #f7f9fc; border-color: #8792a2; }
  button:focus-visible, input:focus, select:focus, textarea:focus { outline: 3px solid rgb(77 126 219 / 25%); outline-offset: 1px; }
  input, select, textarea { background: #fff; border: 1px solid #b8c2d1; border-radius: .45rem; color: #172033; min-width: 0; padding: .58rem .7rem; width: 100%; }
  code, pre { font-family: SFMono-Regular, Consolas, Liberation Mono, monospace; }
  code { color: #526071; font-size: .72rem; }
  .debug-panel { background: #fff; border: 1px solid #d6dde8; border-radius: .85rem; box-shadow: 0 1rem 3rem rgb(23 32 51 / 18%); max-height: calc(100vh - 2rem); overflow: auto; padding: 1rem; pointer-events: auto; position: absolute; right: 1rem; top: 1rem; width: min(34rem, calc(100vw - 2rem)); }
  .inspector-fab { align-items: center; background: #fff; border: 1px solid #6936f1; border-radius: 50%; box-shadow: 0 .6rem 1.5rem rgb(23 32 51 / 20%); display: flex; height: 3rem; justify-content: center; padding: .55rem; pointer-events: auto; position: absolute; touch-action: none; width: 3rem; z-index: 1; }
  .inspector-fab:hover { background: #fff; border-color: #6936f1; }
  .inspector-fab:active { cursor: grabbing; }
  .ayme-logo { display: block; height: 100%; width: 100%; }
  .panel-actions { align-items: center; display: flex; gap: .5rem; }
  .collapse-button { align-items: center; display: inline-flex; font-size: 1.15rem; height: 2rem; justify-content: center; line-height: 1; padding: 0; width: 2rem; }
  .panel-heading, .section-heading, .member-heading, .pom-heading, .tool-heading, .execution-heading { align-items: center; display: flex; gap: .75rem; justify-content: space-between; }
  h2, h3, h4, p { margin-top: 0; }
  .eyebrow { color: #667085; font-size: .68rem; font-weight: 750; letter-spacing: .08em; margin: 0 0 .25rem; text-transform: uppercase; }
  .panel-heading h2 { font-size: 1.15rem; margin: 0; }
  .item-count, .status-dot, .member-state, .execution-status, .instance-label { border-radius: 999px; font-size: .68rem; font-weight: 700; padding: .32rem .5rem; white-space: nowrap; }
  .item-count { background: #eef2f7; color: #526071; }
  .panel-tabs { border-bottom: 1px solid #e1e7f0; display: flex; margin: .8rem 0 1rem; }
  .panel-tab { border: 0; border-bottom: 2px solid transparent; border-radius: 0; }
  .panel-tab[aria-selected=true] { border-bottom-color: #315fb7; color: #234c99; }
  .tab-panel { display: grid; gap: 1rem; }
  .debug-section { border-top: 1px solid #e1e7f0; padding-top: 1rem; }
  .debug-section:first-of-type { border-top: 0; padding-top: 0; }
  .section-heading { align-items: flex-start; }
  .section-heading h3 { font-size: .95rem; margin: 0; }
  .section-note, .status-message, .empty-state, .no-parameters, .tool-card p { color: #667085; font-size: .78rem; line-height: 1.45; }
  .status-dot, .member-state-present, .execution-status-succeeded { background: #e8f5ed; color: #27734a; }
  .runtime-details { display: grid; gap: .45rem; grid-template-columns: 1fr 1fr; margin: 0; }
  .runtime-details div { background: #f7f9fc; border-radius: .45rem; padding: .65rem; }
  .runtime-details dt { color: #667085; font-size: .7rem; }
  .runtime-details dd { font-size: .9rem; font-weight: 700; margin: .25rem 0 0; }
  .pom-card, .tool-card, .execution-card, .member-card, .instances-panel, .instance-card { border: 1px solid #d6dde8; border-radius: .6rem; margin-top: .7rem; padding: .75rem; }
  .pom-card { background: #eef2f7; }
  .tool-card, .member-card, .instances-panel, .instance-card { background: #fff; }
  .pom-heading { align-items: flex-start; }
  .pom-heading code, .tool-heading code, .execution-heading code, .member-heading code, .instance-heading code { color: #234c99; font-weight: 700; overflow-wrap: anywhere; }
  .pom-status, .member-meta, .member-card > p, .instance-summary { color: #667085; font-size: .72rem; }
  .subsection-heading { border-bottom: 1px solid #d6dde8; display: flex; justify-content: space-between; margin-top: .85rem; padding: 0 .1rem .45rem; }
  .subsection-heading h4 { color: #354052; font-size: .72rem; margin: 0; text-transform: uppercase; }
  .member-card-interactive { cursor: crosshair; }
  .member-card-interactive:hover, .member-card-interactive:focus-visible, .member-card-selected { background: #fffaf0; border-color: #d9a441; box-shadow: 0 0 0 3px rgb(217 164 65 / 14%); outline: none; }
  .member-state-absent, .member-state-pending { background: #f0f3f8; color: #667085; }
  .member-state-ambiguous, .execution-status-running { background: #fff4d6; color: #8a5a00; }
  .member-state-probe-failed, .execution-status-failed { background: #fcebea; color: #b42318; }
  .instances-panel, .instance-card { overflow: hidden; padding: 0; }
  .instances-panel > summary, .instance-card > summary { cursor: pointer; display: flex; gap: .75rem; justify-content: space-between; padding: .7rem; }
  .instance-list, .member-list, .action-list, .execution-list { display: grid; gap: .6rem; list-style: none; margin: 0; padding: .65rem; }
  .tool-form, .tool-parameters { display: grid; gap: .65rem; }
  .parameter-field label { color: #354052; display: block; font-size: .78rem; font-weight: 700; margin-bottom: .35rem; }
  .invoke-button { justify-self: start; }
  pre { background: #172033; border-radius: .55rem; color: #e8eef8; max-height: 24rem; overflow: auto; padding: .85rem; white-space: pre-wrap; }
  .trace-list { color: #526071; font-size: .72rem; margin: .65rem 0 0; padding-left: 1.2rem; }
  @media (max-width: 640px) { .debug-panel { bottom: .5rem; left: .5rem; max-height: 60vh; right: .5rem; top: auto; width: auto; } }
`;
</script>

<template>
  <component :is="'style'" v-text="inspectorStyles" />
  <DebugPanel
    :page-state="pageState"
    :page-state-captured-at="pageStateCapturedAt"
    :page-state-error="pageStateError"
    :page-state-loading="pageStateLoading"
    :application-model-selection-path="applicationModelSelectionPath"
    :refresh-page-state="refreshPageState"
    :registered-poms="registeredPoms"
    :refresh-pom-members="refreshPomMembers"
    :reset-trace="resetInspectorTrace"
    :trace="trace"
    web-mcp-status="Inspector active. WebMCP publication is optional."
    :preview-application-model-target="previewApplicationModelTarget"
    :clear-application-model-preview="clearApplicationModelPreview"
    :pin-application-model-target="pinApplicationModelTarget"
  />
</template>
