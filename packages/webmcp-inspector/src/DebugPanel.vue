<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
} from "vue";

import type { TraceEntry } from "./withDemoFeedback";
import type {
  JsonValue,
  PomMemberManifest,
  PomMemberObservation,
  RegisteredPomTool,
} from "@ayme-dev/webmcp";
import {
  listRegisteredPomTools,
  type RegisteredPom,
} from "@ayme-dev/webmcp/internal";
import {
  AYME_LOGO_FILL,
  AYME_LOGO_PATH,
  AYME_LOGO_VIEWBOX,
} from "@ayme-dev/design-system/logo";

type ToolArguments = Record<string, JsonValue>;

type ToolExecution = {
  id: number;
  toolName: string;
  pomId: string;
  arguments: ToolArguments;
  status: "running" | "succeeded" | "failed";
  result?: unknown;
  error?: string;
  durationMs?: number;
  trace: TraceEntry[];
};

type PomInstance = {
  className: string;
  displayPath: string;
  probePath: string;
  registration: RegisteredPom;
};

type PomClassCard = {
  className: string;
  kind: "page" | "component";
  members: PomMemberManifest[];
  tools: RegisteredPomTool[];
  registrations: RegisteredPom[];
  instances: PomInstance[];
};

const props = defineProps<{
  pageState: string | undefined;
  pageStateCapturedAt: string | undefined;
  pageStateError: string | undefined;
  pageStateLoading: boolean;
  applicationModelSelectionPath: string | undefined;
  refreshPageState: () => Promise<void>;
  registeredPoms: readonly RegisteredPom[];
  refreshPomMembers: () => Promise<void>;
  resetTrace: () => void;
  trace: readonly TraceEntry[];
  webMcpStatus: string;
  previewApplicationModelTarget: (path: string) => void;
  clearApplicationModelPreview: () => void;
  pinApplicationModelTarget: (path: string) => void;
}>();

const FAB_SIZE = 48;
const FAB_MARGIN = 16;
const DRAG_THRESHOLD = 4;

const activeTab = ref<"app-model" | "page-state">("app-model");
const isCollapsed = ref(false);
const fabButton = ref<HTMLButtonElement>();
const collapseButton = ref<HTMLButtonElement>();
const fabPosition = ref<{ left: number; top: number }>();
const fabWasDragged = ref(false);
const dragState = ref<{
  pointerId: number;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  dragging: boolean;
}>();
const executionHistory = shallowRef<ToolExecution[]>([]);
const toolInputValues = reactive<Record<string, ToolArguments>>({});
let nextExecutionId = 1;

const fabStyle = computed(() => {
  if (!fabPosition.value)
    return { bottom: `${FAB_MARGIN}px`, right: `${FAB_MARGIN}px` };
  return {
    left: `${fabPosition.value.left}px`,
    top: `${fabPosition.value.top}px`,
  };
});

function clampFabPosition(left: number, top: number) {
  const maxLeft = Math.max(
    FAB_MARGIN,
    window.innerWidth - FAB_SIZE - FAB_MARGIN
  );
  const maxTop = Math.max(
    FAB_MARGIN,
    window.innerHeight - FAB_SIZE - FAB_MARGIN
  );
  return {
    left: Math.min(Math.max(left, FAB_MARGIN), maxLeft),
    top: Math.min(Math.max(top, FAB_MARGIN), maxTop),
  };
}

function clampCurrentFabPosition() {
  if (fabPosition.value)
    fabPosition.value = clampFabPosition(
      fabPosition.value.left,
      fabPosition.value.top
    );
}

function collapseInspector() {
  isCollapsed.value = true;
  void nextTick(() => fabButton.value?.focus());
}

function expandInspector() {
  if (fabWasDragged.value) {
    fabWasDragged.value = false;
    return;
  }
  isCollapsed.value = false;
  void nextTick(() => collapseButton.value?.focus());
}

function startFabDrag(event: PointerEvent) {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;

  fabWasDragged.value = false;
  const rect = target.getBoundingClientRect();
  fabPosition.value = { left: rect.left, top: rect.top };
  dragState.value = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startLeft: rect.left,
    startTop: rect.top,
    dragging: false,
  };
  target.setPointerCapture(event.pointerId);
}

function moveFab(event: PointerEvent) {
  const state = dragState.value;
  if (!state || event.pointerId !== state.pointerId) return;

  const deltaX = event.clientX - state.startX;
  const deltaY = event.clientY - state.startY;
  if (!state.dragging && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return;

  state.dragging = true;
  fabWasDragged.value = true;
  event.preventDefault();
  fabPosition.value = clampFabPosition(
    state.startLeft + deltaX,
    state.startTop + deltaY
  );
}

function endFabDrag(event: PointerEvent) {
  const state = dragState.value;
  if (!state || event.pointerId !== state.pointerId) return;

  const target = event.currentTarget;
  if (
    target instanceof HTMLElement &&
    target.hasPointerCapture(event.pointerId)
  )
    target.releasePointerCapture(event.pointerId);
  dragState.value = undefined;
}

onMounted(() => window.addEventListener("resize", clampCurrentFabPosition));
onBeforeUnmount(() =>
  window.removeEventListener("resize", clampCurrentFabPosition)
);

const availablePomTools = computed(() => {
  if (!props.registeredPoms.length) return new Map<string, RegisteredPomTool>();
  return new Map(listRegisteredPomTools().map((tool) => [tool.name, tool]));
});

const pomClassCards = computed(() => {
  const cards = new Map<string, PomClassCard>();

  for (const registration of props.registeredPoms) {
    const page = registration.manifest;
    const pageCard = ensurePomClassCard(
      cards,
      page.className,
      "page",
      page.members,
      registration.tools.filter((tool) => tool.componentClassName === undefined)
    );
    pageCard.registrations.push(registration);
    pageCard.instances.push({
      className: page.className,
      displayPath: page.className,
      probePath: "",
      registration,
    });

    for (const component of page.components) {
      ensurePomClassCard(
        cards,
        component.className,
        "component",
        component.members,
        registration.tools.filter(
          (tool) => tool.componentClassName === component.className
        )
      );
    }

    for (const instance of discoverComponentInstances(registration)) {
      const componentCard = cards.get(instance.className);
      if (componentCard) componentCard.instances.push(instance);
    }
  }

  return [...cards.values()];
});

function toolInput(tool: RegisteredPomTool) {
  const existing = toolInputValues[tool.name];
  if (existing) return existing;

  const values: ToolArguments = {};
  for (const parameter of tool.parameters) {
    const firstEnumValue = parameter.schema.enum?.[0];
    if (firstEnumValue !== undefined) {
      values[parameter.name] = firstEnumValue;
    } else if (
      parameter.schema.type === "number" ||
      parameter.schema.type === "integer"
    ) {
      values[parameter.name] = 0;
    } else if (parameter.schema.type === "boolean") {
      values[parameter.name] = false;
    } else if (parameter.schema.type === "object") {
      values[parameter.name] = {};
    } else {
      values[parameter.name] = "";
    }
  }
  toolInputValues[tool.name] = values;
  return values;
}

function inputType(tool: RegisteredPomTool, parameterName: string) {
  const parameter = tool.parameters.find(
    (candidate) => candidate.name === parameterName
  );
  return parameter?.schema.type === "number" ||
    parameter?.schema.type === "integer"
    ? "number"
    : "text";
}

function jsonInputValue(tool: RegisteredPomTool, parameterName: string) {
  return JSON.stringify(toolInput(tool)[parameterName]);
}

function updateJsonInput(
  tool: RegisteredPomTool,
  parameterName: string,
  event: Event
) {
  if (!(event.target instanceof HTMLTextAreaElement)) return;

  try {
    const value: unknown = JSON.parse(event.target.value);
    if (!isJsonValue(value)) throw new Error("JSON value required.");
    toolInput(tool)[parameterName] = value;
    event.target.setCustomValidity("");
  } catch {
    event.target.setCustomValidity("Enter valid JSON.");
  }
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  return Object.values(value).every(isJsonValue);
}

function ensurePomClassCard(
  cards: Map<string, PomClassCard>,
  className: string,
  kind: PomClassCard["kind"],
  members: readonly PomMemberManifest[],
  tools: readonly RegisteredPomTool[]
) {
  const existing = cards.get(className);
  if (existing) {
    for (const tool of tools) {
      if (!existing.tools.some((candidate) => candidate.name === tool.name))
        existing.tools.push(tool);
    }
    return existing;
  }

  const card: PomClassCard = {
    className,
    kind,
    members: [...members],
    tools: [...tools],
    registrations: [],
    instances: [],
  };
  cards.set(className, card);
  return card;
}

function discoverComponentInstances(registration: RegisteredPom) {
  const components = new Map(
    registration.manifest.components.map((component) => [
      component.className,
      component,
    ])
  );
  const instances: PomInstance[] = [];

  function visit(members: readonly PomMemberManifest[], prefix: string) {
    for (const member of members) {
      if (member.kind !== "component") continue;

      const memberPath = prefix
        ? `${prefix}.${member.memberName}`
        : member.memberName;
      const component = components.get(member.componentClassName);
      if (!component) continue;

      const count = member.collection
        ? (observationAt(registration, memberPath)?.count ?? 0)
        : 1;
      for (let index = 0; index < count; index += 1) {
        const probePath = member.collection
          ? `${memberPath}[${index}]`
          : memberPath;
        instances.push({
          className: component.className,
          displayPath: `${registration.manifest.className}.${probePath}`,
          probePath,
          registration,
        });
        visit(component.members, probePath);
      }
    }
  }

  visit(registration.manifest.members, "");
  return instances;
}

function observationAt(registration: RegisteredPom, path: string) {
  return registration.memberObservations.find(
    (observation) => observation.memberName === path
  );
}

function memberProbePath(prefix: string, member: PomMemberManifest) {
  const memberPath = prefix
    ? `${prefix}.${member.memberName}`
    : member.memberName;
  return member.kind === "component" && !member.collection
    ? `${memberPath}.root`
    : memberPath;
}

function observationsForMember(card: PomClassCard, member: PomMemberManifest) {
  if (card.kind === "page") {
    const registration = card.registrations[0];
    const observation = registration
      ? observationAt(registration, memberProbePath("", member))
      : undefined;
    return observation ? [observation] : [];
  }

  return card.instances
    .map((instance) =>
      observationAt(
        instance.registration,
        memberProbePath(instance.probePath, member)
      )
    )
    .filter(
      (observation): observation is PomMemberObservation =>
        observation !== undefined
    );
}

function hasPendingProbe(card: PomClassCard) {
  return card.registrations.some(
    (registration) => registration.memberObservations.length === 0
  );
}

function memberState(observation: PomMemberObservation | undefined) {
  if (!observation) return "pending";
  if (observation.error) return "probe failed";
  if (observation.kind === "component-collection")
    return observation.count > 0 ? "present" : "absent";
  if (observation.count === 0) return "absent";
  if (observation.count === 1) return "present";
  return "ambiguous";
}

function classMemberState(card: PomClassCard, member: PomMemberManifest) {
  const observations = observationsForMember(card, member);
  if (!observations.length) return hasPendingProbe(card) ? "pending" : "absent";
  if (observations.some((observation) => observation.error))
    return "probe failed";
  if (card.kind === "page") return memberState(observations[0]);

  const presentCount = observations.filter(
    (observation) => observation.count > 0
  ).length;
  if (presentCount === observations.length) return "present";
  if (presentCount === 0) return "absent";
  return "ambiguous";
}

function memberSummary(observation: PomMemberObservation | undefined) {
  if (!observation) return "Waiting for the first page probe.";
  if (observation.error) return observation.error;
  if (observation.kind === "component-collection") {
    return `${observation.count} ${observation.count === 1 ? "component" : "components"}`;
  }
  return `${observation.count} ${observation.count === 1 ? "match" : "matches"}`;
}

function classMemberSummary(card: PomClassCard, member: PomMemberManifest) {
  const observations = observationsForMember(card, member);
  if (!observations.length) {
    return hasPendingProbe(card)
      ? "Waiting for the first page probe."
      : "No instances found.";
  }
  if (observations.some((observation) => observation.error)) {
    return (
      observations.find((observation) => observation.error)?.error ??
      "Probe failed."
    );
  }
  if (card.kind === "page") return memberSummary(observations[0]);

  const presentCount = observations.filter(
    (observation) => observation.count > 0
  ).length;
  if (member.kind === "component" && member.collection) {
    const componentCount = observations.reduce(
      (total, observation) => total + observation.count,
      0
    );
    return `${componentCount} ${componentCount === 1 ? "component" : "components"} across ${observations.length} parent ${
      observations.length === 1 ? "instance" : "instances"
    }`;
  }
  return `${presentCount}/${observations.length} instances have a match`;
}

function memberKindLabel(member: PomMemberManifest) {
  if (member.kind === "component") {
    return `${member.componentClassName}${member.collection ? "[]" : ""} · ${member.access}`;
  }
  return `${member.access} · locator`;
}

function instanceState(card: PomClassCard, instance: PomInstance) {
  if (card.kind === "page") return "registered";
  return memberState(
    observationAt(instance.registration, `${instance.probePath}.root`)
  );
}

function instanceSummary(card: PomClassCard, instance: PomInstance) {
  if (card.kind === "page") return "registered POM instance";
  const root = observationAt(
    instance.registration,
    `${instance.probePath}.root`
  );
  return root ? memberSummary(root) : "Waiting for the first probe.";
}

function instanceMemberSummary(
  instance: PomInstance,
  member: PomMemberManifest
) {
  return memberSummary(
    observationAt(
      instance.registration,
      memberProbePath(instance.probePath, member)
    )
  );
}

function instanceMemberPath(instance: PomInstance, member: PomMemberManifest) {
  return `${instance.displayPath}.${member.memberName}`;
}

function isHighlightableMember(member: PomMemberManifest) {
  return member.kind === "locator" || member.kind === "component";
}

function pageMemberTargetPath(pom: PomClassCard, member: PomMemberManifest) {
  return `${pom.className}.${memberProbePath("", member)}`;
}

function instanceMemberTargetPath(
  instance: PomInstance,
  member: PomMemberManifest
) {
  return `${instance.registration.manifest.className}.${memberProbePath(
    instance.probePath,
    member
  )}`;
}

function isHighlightedPath(path: string, selectionPath?: string) {
  return selectionPath === path;
}

function instanceCountSummary(card: PomClassCard) {
  if (!card.instances.length)
    return hasPendingProbe(card) ? "Waiting" : "0 instances";
  if (card.kind === "page") return "1 instance";

  const presentCount = card.instances.filter(
    (instance) => instanceState(card, instance) === "present"
  ).length;
  return `${card.instances.length} ${card.instances.length === 1 ? "instance" : "instances"} · ${presentCount}/${
    card.instances.length
  } present`;
}

async function invokeTool(tool: RegisteredPomTool) {
  const activeTool = availablePomTools.value.get(tool.name);
  if (!activeTool) return;
  tool = activeTool;
  const startedAt = Date.now();
  props.resetTrace();
  const execution: ToolExecution = {
    id: nextExecutionId,
    toolName: tool.name,
    pomId: tool.pomId,
    arguments: { ...toolInput(tool) },
    status: "running",
    trace: [],
  };
  nextExecutionId += 1;
  executionHistory.value = [execution, ...executionHistory.value];

  try {
    execution.result = await tool.execute(execution.arguments);
    execution.status = "succeeded";
    executionHistory.value = [...executionHistory.value];
  } catch (error) {
    execution.status = "failed";
    execution.error = errorMessage(error);
    executionHistory.value = [...executionHistory.value];
  } finally {
    execution.durationMs = Date.now() - startedAt;
    execution.trace = [...props.trace];
    executionHistory.value = [...executionHistory.value];
    void props.refreshPageState();
  }
}

function clearExecutionHistory() {
  executionHistory.value = [];
  props.resetTrace();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
</script>

<template>
  <button
    v-if="isCollapsed"
    ref="fabButton"
    class="inspector-fab"
    type="button"
    aria-label="Open Ayme POM inspector"
    aria-expanded="false"
    :style="fabStyle"
    @pointerdown="startFabDrag"
    @pointermove="moveFab"
    @pointerup="endFabDrag"
    @pointercancel="endFabDrag"
    @click="expandInspector"
  >
    <svg
      class="ayme-logo"
      :viewBox="AYME_LOGO_VIEWBOX"
      aria-hidden="true"
      focusable="false"
    >
      <path :d="AYME_LOGO_PATH" :fill="AYME_LOGO_FILL" />
    </svg>
  </button>

  <aside v-else class="debug-panel" aria-label="Ayme debug utilities">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Ayme debug utilities</p>
        <h2>POM inspector</h2>
      </div>
      <div class="panel-actions">
        <span class="item-count">{{ registeredPoms.length }} POMs</span>
        <button
          ref="collapseButton"
          class="collapse-button"
          type="button"
          aria-label="Collapse inspector"
          aria-expanded="true"
          @click="collapseInspector"
        >
          −
        </button>
      </div>
    </div>

    <div class="panel-tabs" role="tablist" aria-label="Inspector views">
      <button
        id="app-model-tab"
        class="panel-tab"
        role="tab"
        type="button"
        :aria-selected="activeTab === 'app-model'"
        aria-controls="app-model-panel"
        @click="activeTab = 'app-model'"
      >
        App Model
      </button>
      <button
        id="page-state-tab"
        class="panel-tab"
        role="tab"
        type="button"
        :aria-selected="activeTab === 'page-state'"
        aria-controls="page-state-panel"
        @click="activeTab = 'page-state'"
      >
        Page State
      </button>
    </div>

    <div
      v-if="activeTab === 'app-model'"
      id="app-model-panel"
      class="tab-panel"
      role="tabpanel"
      aria-labelledby="app-model-tab"
    >
      <section class="debug-section" aria-labelledby="runtime-heading">
        <div class="section-heading">
          <h3 id="runtime-heading">Runtime</h3>
          <span class="status-dot">Ready</span>
        </div>
        <dl class="runtime-details">
          <div>
            <dt>Recognized POMs</dt>
            <dd>{{ registeredPoms.length }}</dd>
          </div>
          <div>
            <dt>Browser runtime</dt>
            <dd>DOM-backed</dd>
          </div>
        </dl>
        <p class="status-message">{{ webMcpStatus }}</p>
      </section>

      <section class="debug-section" aria-labelledby="poms-heading">
        <div class="section-heading">
          <div>
            <h3 id="poms-heading">Recognized POM classes</h3>
            <p class="section-note">
              Hover a member to preview its live element; click to select or
              toggle it. Runtime instances are available below each card.
            </p>
          </div>
          <button type="button" @click="refreshPomMembers">
            Refresh probes
          </button>
        </div>

        <div v-if="!pomClassCards.length" class="empty-state">
          No POM classes are recognized.
        </div>
        <article
          v-for="pom in pomClassCards"
          :key="pom.className"
          class="pom-card"
          :data-pom-id="pom.className"
          :data-pom-class="pom.className"
        >
          <div class="pom-heading">
            <div>
              <code>{{ pom.className }}</code>
              <p class="pom-status">
                {{ pom.kind === "page" ? "Page POM" : "Component POM" }}
              </p>
            </div>
            <span class="item-count"
              >{{ pom.members.length }} members ·
              {{ pom.tools.length }} actions</span
            >
          </div>

          <div class="subsection-heading">
            <h4>Members</h4>
            <span>{{ pom.members.length }}</span>
          </div>
          <div v-if="pom.members.length" class="member-list">
            <div
              v-for="member in pom.members"
              :key="member.memberName"
              :class="[
                'member-card',
                {
                  'member-card-interactive': isHighlightableMember(member),
                  'member-card-selected': isHighlightedPath(
                    pageMemberTargetPath(pom, member),
                    applicationModelSelectionPath
                  ),
                },
              ]"
              :data-member-name="member.memberName"
              :data-highlight-path="pageMemberTargetPath(pom, member)"
              :tabindex="isHighlightableMember(member) ? 0 : undefined"
              :role="isHighlightableMember(member) ? 'button' : undefined"
              :aria-pressed="
                isHighlightableMember(member)
                  ? isHighlightedPath(
                      pageMemberTargetPath(pom, member),
                      applicationModelSelectionPath
                    )
                  : undefined
              "
              @mouseenter="
                isHighlightableMember(member) &&
                previewApplicationModelTarget(pageMemberTargetPath(pom, member))
              "
              @mouseleave="clearApplicationModelPreview"
              @focus="
                isHighlightableMember(member) &&
                previewApplicationModelTarget(pageMemberTargetPath(pom, member))
              "
              @blur="clearApplicationModelPreview"
              @click="
                isHighlightableMember(member) &&
                pinApplicationModelTarget(pageMemberTargetPath(pom, member))
              "
              @keydown.enter.prevent="
                isHighlightableMember(member) &&
                pinApplicationModelTarget(pageMemberTargetPath(pom, member))
              "
              @keydown.space.prevent="
                isHighlightableMember(member) &&
                pinApplicationModelTarget(pageMemberTargetPath(pom, member))
              "
            >
              <div class="member-heading">
                <div>
                  <code>{{ member.memberName }}</code>
                  <p class="member-meta">{{ memberKindLabel(member) }}</p>
                </div>
                <span
                  :class="[
                    'member-state',
                    `member-state-${classMemberState(pom, member)}`,
                  ]"
                >
                  {{ classMemberState(pom, member) }}
                </span>
              </div>
              <p>{{ classMemberSummary(pom, member) }}</p>
            </div>
          </div>
          <p v-else class="empty-state">This POM has no inspectable members.</p>

          <div class="subsection-heading action-section-heading">
            <h4>Actions</h4>
            <span>{{ pom.tools.length }}</span>
          </div>
          <div v-if="pom.tools.length" class="action-list">
            <div
              v-for="tool in pom.tools"
              :key="tool.name"
              class="tool-card"
              :data-tool-name="tool.name"
            >
              <div class="tool-heading">
                <code>{{ tool.name }}</code>
                <span>
                  WebMCP
                  {{
                    availablePomTools.has(tool.name)
                      ? "available"
                      : "unavailable"
                  }}
                </span>
              </div>
              <p>{{ tool.description }}</p>

              <form class="tool-form" @submit.prevent="invokeTool(tool)">
                <div v-if="tool.parameters.length" class="tool-parameters">
                  <div
                    v-for="parameter in tool.parameters"
                    :key="parameter.name"
                    class="parameter-field"
                  >
                    <label :for="`tool-${tool.name}-${parameter.name}`">
                      {{ parameter.name
                      }}<span v-if="parameter.optional"> (optional)</span>
                    </label>
                    <select
                      v-if="parameter.schema.enum"
                      :id="`tool-${tool.name}-${parameter.name}`"
                      v-model="toolInput(tool)[parameter.name]"
                    >
                      <option
                        v-for="option in parameter.schema.enum"
                        :key="String(option)"
                        :value="option"
                      >
                        {{ option }}
                      </option>
                    </select>
                    <textarea
                      v-else-if="parameter.schema.type === 'object'"
                      :id="`tool-${tool.name}-${parameter.name}`"
                      :value="jsonInputValue(tool, parameter.name)"
                      rows="3"
                      @change="updateJsonInput(tool, parameter.name, $event)"
                    />
                    <input
                      v-else
                      :id="`tool-${tool.name}-${parameter.name}`"
                      v-model="toolInput(tool)[parameter.name]"
                      :type="inputType(tool, parameter.name)"
                    />
                  </div>
                </div>
                <p v-else class="no-parameters">No arguments required.</p>
                <button
                  class="primary-button invoke-button"
                  type="submit"
                  :disabled="!availablePomTools.has(tool.name)"
                >
                  Invoke tool
                </button>
              </form>
            </div>
          </div>
          <p v-else class="empty-state">This POM has no registered actions.</p>

          <details class="instances-panel" :data-instance-list="pom.className">
            <summary class="instances-heading">
              <span>Instances</span>
              <span class="item-count">{{ instanceCountSummary(pom) }}</span>
            </summary>
            <p v-if="!pom.instances.length" class="empty-state">
              {{
                hasPendingProbe(pom)
                  ? "Waiting for the first page probe."
                  : "No instances found."
              }}
            </p>
            <div v-else class="instance-list">
              <details
                v-for="instance in pom.instances"
                :key="instance.displayPath"
                class="instance-card"
                :data-instance-path="instance.displayPath"
              >
                <summary class="instance-heading">
                  <code>{{ instance.displayPath }}</code>
                  <span v-if="pom.kind === 'page'" class="instance-label"
                    >registered</span
                  >
                  <span
                    v-else
                    :class="[
                      'member-state',
                      `member-state-${instanceState(pom, instance)}`,
                    ]"
                  >
                    {{ instanceState(pom, instance) }}
                  </span>
                </summary>
                <p class="instance-summary">
                  {{ instanceSummary(pom, instance) }}
                </p>
                <div class="member-list">
                  <div
                    v-for="member in pom.members"
                    :key="member.memberName"
                    :class="[
                      'member-card',
                      'instance-member-card',
                      {
                        'member-card-interactive':
                          isHighlightableMember(member),
                        'member-card-selected': isHighlightedPath(
                          instanceMemberTargetPath(instance, member),
                          applicationModelSelectionPath
                        ),
                      },
                    ]"
                    :data-instance-member-name="
                      instanceMemberPath(instance, member)
                    "
                    :data-highlight-path="
                      instanceMemberTargetPath(instance, member)
                    "
                    :tabindex="isHighlightableMember(member) ? 0 : undefined"
                    :role="isHighlightableMember(member) ? 'button' : undefined"
                    :aria-pressed="
                      isHighlightableMember(member)
                        ? isHighlightedPath(
                            instanceMemberTargetPath(instance, member),
                            applicationModelSelectionPath
                          )
                        : undefined
                    "
                    @mouseenter="
                      isHighlightableMember(member) &&
                      previewApplicationModelTarget(
                        instanceMemberTargetPath(instance, member)
                      )
                    "
                    @mouseleave="clearApplicationModelPreview"
                    @focus="
                      isHighlightableMember(member) &&
                      previewApplicationModelTarget(
                        instanceMemberTargetPath(instance, member)
                      )
                    "
                    @blur="clearApplicationModelPreview"
                    @click="
                      isHighlightableMember(member) &&
                      pinApplicationModelTarget(
                        instanceMemberTargetPath(instance, member)
                      )
                    "
                    @keydown.enter.prevent="
                      isHighlightableMember(member) &&
                      pinApplicationModelTarget(
                        instanceMemberTargetPath(instance, member)
                      )
                    "
                    @keydown.space.prevent="
                      isHighlightableMember(member) &&
                      pinApplicationModelTarget(
                        instanceMemberTargetPath(instance, member)
                      )
                    "
                  >
                    <div class="member-heading">
                      <div>
                        <code>{{ member.memberName }}</code>
                        <p class="member-meta">{{ memberKindLabel(member) }}</p>
                      </div>
                      <span
                        :class="[
                          'member-state',
                          `member-state-${memberState(
                            observationAt(
                              instance.registration,
                              memberProbePath(instance.probePath, member)
                            )
                          )}`,
                        ]"
                      >
                        {{
                          memberState(
                            observationAt(
                              instance.registration,
                              memberProbePath(instance.probePath, member)
                            )
                          )
                        }}
                      </span>
                    </div>
                    <p>{{ instanceMemberSummary(instance, member) }}</p>
                  </div>
                </div>
              </details>
            </div>
          </details>
        </article>
      </section>

      <section class="debug-section" aria-labelledby="history-heading">
        <div class="section-heading">
          <h3 id="history-heading">Recent executions</h3>
          <button
            type="button"
            :disabled="!executionHistory.length"
            @click="clearExecutionHistory"
          >
            Clear
          </button>
        </div>
        <p v-if="!executionHistory.length" class="empty-state">
          Invoke a tool to see its execution here.
        </p>
        <ol v-else class="execution-list">
          <li
            v-for="execution in executionHistory"
            :key="execution.id"
            class="execution-card"
          >
            <div class="execution-heading">
              <code>{{ execution.toolName }}</code>
              <span
                :class="[
                  'execution-status',
                  `execution-status-${execution.status}`,
                ]"
              >
                {{ execution.status }}
              </span>
              <span v-if="execution.durationMs !== undefined"
                >{{ execution.durationMs }} ms</span
              >
            </div>
            <pre>{{
              JSON.stringify(
                {
                  arguments: execution.arguments,
                  result: execution.result,
                  error: execution.error,
                  trace: execution.trace,
                },
                null,
                2
              )
            }}</pre>
          </li>
        </ol>
      </section>

      <section class="debug-section" aria-labelledby="trace-heading">
        <div class="section-heading">
          <h3 id="trace-heading">Latest browser trace</h3>
        </div>
        <pre v-if="trace.length">{{ JSON.stringify(trace, null, 2) }}</pre>
        <p v-else class="empty-state">No browser POM operations yet.</p>
      </section>
    </div>

    <div
      v-else
      id="page-state-panel"
      class="tab-panel"
      role="tabpanel"
      aria-labelledby="page-state-tab"
    >
      <section
        class="debug-section page-state-section"
        aria-labelledby="page-state-heading"
      >
        <div class="section-heading">
          <div>
            <h3 id="page-state-heading">Structural page state</h3>
            <p class="section-note">
              Scoped diagnostic snapshot of the demo application. It is separate
              from the document-wide Page State Session used by
              <code>get_page_context</code> and consumer ref resolution.
            </p>
          </div>
          <button
            type="button"
            :disabled="pageStateLoading"
            @click="refreshPageState"
          >
            {{ pageStateLoading ? "Refreshing…" : "Refresh" }}
          </button>
        </div>
        <p v-if="pageStateError" class="form-error">{{ pageStateError }}</p>
        <p v-else-if="pageStateLoading && !pageState" class="empty-state">
          Capturing page state…
        </p>
        <pre
          v-else-if="pageState"
          class="page-state-output"
        ><code class="language-yaml">{{ pageState }}</code></pre>
        <p v-else class="empty-state">
          Waiting for the first page-state capture.
        </p>
        <p v-if="pageStateCapturedAt" class="capture-meta">
          Captured {{ pageStateCapturedAt }}
        </p>
      </section>
    </div>
  </aside>
</template>
