/**
 * The props of `AymeProvider`, one per option of `createAyme`, shared by
 * the index and the absent entry so both normalise a template's kebab-case
 * attributes the same way. Only types come from the runtime, so the absent
 * entry stays free of it.
 */
import type { PropType } from "vue";
import type {
  AymeOptions,
  AymePage,
  AymeWebMcpOptions,
  CustomTool,
  GoalLoopDecisionFunction,
} from "@ayme-dev/ayme";

// Vue needs each prop declared; `satisfies` fails the build when a runtime
// option is missing here.
export const providerProps = {
  pageFactory: {
    type: Function as PropType<() => AymePage>,
    required: false,
  },
  ignore: {
    type: Function as PropType<(element: Element) => boolean>,
    required: false,
  },
  customTools: { type: Array as PropType<CustomTool[]>, required: false },
  /** @experimental */
  goalLoop: {
    type: Function as PropType<GoalLoopDecisionFunction>,
    required: false,
  },
  webMCP: {
    type: Object as PropType<AymeWebMcpOptions>,
    required: false,
  },
  // A default of undefined keeps an absent prop unset, not cast to false.
  inspector: {
    type: [Boolean, Object] as PropType<AymeOptions["inspector"]>,
    default: undefined,
  },
  agentConnection: {
    type: [Boolean, Object] as PropType<AymeOptions["agentConnection"]>,
    default: undefined,
  },
  navigate: {
    type: Function as PropType<NonNullable<AymeOptions["navigate"]>>,
    required: false,
  },
} satisfies Record<keyof AymeOptions, unknown>;
