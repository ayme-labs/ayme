<script setup lang="ts">
import {
  computed,
  h,
  markRaw,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import { Check, CircleAlert, Copy, LoaderCircle, Plug } from "@lucide/vue";
import { ConfigProvider } from "reka-ui";
import { toast } from "vue-sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/sonner";
import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "@/components/ui/stepper";
import { relayPackage, repairPrompt, setupPrompt } from "./agentPrompts";
import PromptBlock from "./PromptBlock.vue";

const { origin } = window.location;
const prompt = setupPrompt(origin + window.location.pathname, origin);
const fixPrompt = repairPrompt(origin);

type RelayStatus =
  "idle" | "searching" | "found" | "rejected" | "not-found" | "load-failed";

const status = ref<RelayStatus>("idle");
let settle: ReturnType<typeof setTimeout> | undefined;

function search() {
  status.value = "searching";
  clearTimeout(settle);
  settle = setTimeout(() => (status.value = "not-found"), 20_000);
}

function connect() {
  search();
  const script = document.createElement("script");
  script.dataset.aymeRelay = "true";
  script.src = `https://cdn.jsdelivr.net/npm/${relayPackage}/dist/browser/embed.js`;
  script.onerror = () => {
    script.remove();
    clearTimeout(settle);
    status.value = "load-failed";
  };
  document.head.append(script);
}

// The embed goes dormant after a minute and then probes only the default
// port; this makes its hidden widget scan every relay port again.
function retry() {
  search();
  document
    .querySelector<HTMLIFrameElement>("iframe[data-webmcp-relay]")
    ?.contentWindow?.postMessage({ type: "webmcp.connect" }, origin);
}

// The embed has no connection API. These are its widget's internal messages in
// 5.1.0: a list request means a relay answered; a rejection follows when that
// relay refuses this origin, and the widget then retries every half second.
// Re-verify the names whenever relayPackage changes.
function onMessage(event: MessageEvent) {
  if (event.origin !== origin || status.value === "idle") return;
  if (event.data?.type === "webmcp.relay.rejected") {
    clearTimeout(settle);
    status.value = "rejected";
  } else if (event.data?.type === "webmcp.tools.list.request") {
    clearTimeout(settle);
    settle = setTimeout(() => (status.value = "found"), 1_000);
  }
}

onMounted(() => window.addEventListener("message", onMessage));
onBeforeUnmount(() => {
  window.removeEventListener("message", onMessage);
  clearTimeout(settle);
});

const steps = [
  { step: 1, label: "Set up", title: "Set up your agent" },
  { step: 2, label: "Connect", title: "Connect this page" },
] as const;

const open = ref(false);
const step = ref(1);
const connected = computed(() => status.value === "found");
const currentStep = computed(
  () => steps.find((candidate) => candidate.step === step.value) ?? steps[0]
);

// The wizard belongs to the site chrome, not to the playground, so its dialog
// is teleported inside this component instead of to <body>. See App.vue.
const wizardHost = useTemplateRef<HTMLElement>("wizardHost");

function openWizard() {
  if (connected.value) step.value = 2;
  open.value = true;
}

// vue-sonner renders an action's label as plain text only, so the copy button
// with its icon lives in the toast's description instead.
let connectedToast: string | number | undefined;
const ConnectedToastBody = () =>
  h("div", { class: "grid justify-items-start gap-2" }, [
    h("p", "Ask your agent to list this page’s tools."),
    h(
      Button,
      {
        variant: "outline",
        size: "sm",
        type: "button",
        "data-action": "copy-prompt-from-toast",
        onClick: () => {
          void navigator.clipboard.writeText(prompt).catch(() => {});
          toast.dismiss(connectedToast);
        },
      },
      () => [h(Copy), "Copy prompt"]
    ),
  ]);

// An open dialog blocks the page for the agent, so a connection closes it.
watch(connected, (isConnected) => {
  if (!isConnected) return;
  open.value = false;
  connectedToast = toast.success("Connected to your relay", {
    description: markRaw(ConnectedToastBody),
  });
});
</script>

<template>
  <div :data-relay-status="status">
    <Button
      variant="outline"
      data-action="open-agent-wizard"
      type="button"
      @click="openWizard"
    >
      <Plug />
      Try with your own coding agent
      <Badge v-if="connected" variant="secondary">Connected</Badge>
    </Button>

    <div ref="wizardHost" />
    <Toaster position="top-right" rich-colors />

    <ConfigProvider :teleport-to="wizardHost ?? undefined">
      <Dialog v-model:open="open">
        <!--
          Wide enough that the setup prompt's longest line fits without
          wrapping or a horizontal scrollbar on the hosted origin.
        -->
        <DialogContent class="max-h-[90svh] gap-6 overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{{ currentStep.title }}</DialogTitle>
            <DialogDescription>
              Connect this page to a coding agent running on your computer.
            </DialogDescription>
          </DialogHeader>

          <Stepper v-model="step" class="w-full items-start gap-1">
            <StepperItem
              v-for="item in steps"
              :key="item.step"
              :step="item.step"
              class="relative w-full flex-col"
            >
              <StepperSeparator
                v-if="item.step !== steps.length"
                class="absolute top-5 right-[calc(-50%+1rem)] left-[calc(50%+1rem)] h-0.5 shrink-0 rounded-full"
              />
              <StepperTrigger class="gap-2">
                <StepperIndicator
                  class="border bg-background group-data-[state=completed]:border-primary group-data-[state=completed]:bg-primary group-data-[state=completed]:text-primary-foreground"
                >
                  <Check v-if="item.step < step" class="size-4" />
                  <span v-else class="text-sm">{{ item.step }}</span>
                </StepperIndicator>
                <StepperTitle
                  class="text-xs font-medium text-muted-foreground group-data-[state=active]:text-foreground"
                >
                  {{ item.label }}
                </StepperTitle>
              </StepperTrigger>
            </StepperItem>
          </Stepper>

          <!-- 1. Set up your agent -->
          <div v-if="step === 1" class="grid gap-3 text-sm">
            <p>
              Your agent (Claude Code, Codex, …) can’t see browser tabs. The
              <a
                class="font-medium underline underline-offset-4"
                href="https://github.com/WebMCP-org/npm-packages/tree/main/packages/webmcp-local-relay"
                target="_blank"
                rel="noreferrer"
                >WebMCP local relay</a
              >
              is a small open-source program on your computer that passes
              messages between this page and your agent.
            </p>
            <p>
              Paste this prompt to your agent to add it. If the agent needs a
              restart to load the relay, restart it, then continue here.
            </p>
            <PromptBlock name="prompt" :text="prompt" />
          </div>

          <!-- 2. Connect this page -->
          <div v-else class="grid gap-3 text-sm">
            <p class="text-muted-foreground">
              The relay runs on your computer, so
              <a
                class="underline underline-offset-4"
                href="https://developer.chrome.com/blog/local-network-access"
                target="_blank"
                rel="noreferrer"
                >Chrome asks</a
              >
              whether this site may reach it. Allow it to connect.
            </p>
            <div
              aria-live="polite"
              class="grid gap-2 rounded-md border bg-muted/50 p-3"
            >
              <p v-if="status === 'idle'" class="text-muted-foreground">
                Nothing is loaded yet.
              </p>
              <p v-else-if="status === 'searching'" class="flex gap-2">
                <LoaderCircle class="mt-0.5 size-4 shrink-0 animate-spin" />
                Looking for the relay on your computer…
              </p>
              <p v-else-if="status === 'found'" class="flex gap-2">
                <Check class="mt-0.5 size-4 shrink-0" />
                Connected to your relay. Ask your agent to list this page’s
                tools.
              </p>
              <template v-else-if="status === 'rejected'">
                <p class="flex gap-2 text-destructive" role="alert">
                  <CircleAlert class="mt-0.5 size-4 shrink-0" />
                  <span>
                    A relay answered but refused this page: it was started for a
                    different address. Paste this prompt to your agent, then try
                    again.
                  </span>
                </p>
                <PromptBlock name="fix-prompt" :text="fixPrompt" />
              </template>
              <p v-else-if="status === 'not-found'" class="flex gap-2">
                <CircleAlert class="mt-0.5 size-4 shrink-0" />
                <span>
                  No relay found. Either the agent still needs a restart, or
                  Chrome’s prompt was denied or dismissed.
                </span>
              </p>
              <p v-else class="flex gap-2 text-destructive" role="alert">
                <CircleAlert class="mt-0.5 size-4 shrink-0" />
                <span>
                  The relay script did not load from jsDelivr. Check your
                  connection and connect again.
                </span>
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              v-if="step === 2 && !connected"
              variant="outline"
              data-action="wizard-back"
              type="button"
              @click="step = 1"
            >
              Back
            </Button>
            <Button
              v-if="step === 1"
              data-action="wizard-next"
              type="button"
              @click="step = 2"
            >
              Next
            </Button>
            <Button
              v-else-if="connected"
              data-action="wizard-done"
              type="button"
              @click="open = false"
            >
              Done
            </Button>
            <Button
              v-else-if="status === 'not-found' || status === 'rejected'"
              data-action="retry-relay"
              type="button"
              @click="retry"
            >
              Try again
            </Button>
            <Button
              v-else
              data-action="connect-relay"
              type="button"
              :disabled="status === 'searching'"
              @click="connect"
            >
              Relay installed — connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfigProvider>
  </div>
</template>
