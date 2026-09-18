<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
  type Ref,
} from "vue";
import { Check, CircleAlert, LoaderCircle, Plug } from "lucide-vue-next";
import { ConfigProvider } from "reka-ui";
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
import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "@/components/ui/stepper";

// One version for the browser embed and the MCP server the visitor installs.
const relayPackage = "@mcp-b/webmcp-local-relay@5.1.0";
const { origin } = window.location;
const pageUrl = origin + window.location.pathname;

// Self-routing: the visitor pastes it before and after restarting the agent.
const prompt = `I'm trying the Ayme WebMCP playground at ${pageUrl}.

If you have no webmcp_list_sources tool yet: add the WebMCP local relay as an MCP
server, using this client's own MCP configuration format, user-level if possible:

  command: npx
  args:    -y ${relayPackage} --widget-origin ${origin}

Install nothing else and change no project files. Then tell me to restart you
and paste this prompt again.

If you do have it: call webmcp_list_sources and webmcp_list_tools, and show me
the tools that page exposes. Don't invoke any yet; suggest one I can try.
If the page isn't listed, tell me to open "Try with your own coding agent" on
the page, connect there and allow Chrome's prompt, and check that the relay's
--widget-origin is exactly ${origin}.`;

// For a relay that answers but refuses this origin.
const fixPrompt = `The WebMCP local relay refused the page at ${origin}: its --widget-origin
does not match. Find the webmcp-local-relay MCP server in this client's MCP
configuration and make its arguments exactly:

  -y ${relayPackage} --widget-origin ${origin}

Change nothing else, then tell me to restart you. If the configuration already
says exactly that, another program's relay is answering instead, for example a
second coding agent's: tell me that instead of changing anything.`;

type RelayStatus =
  "idle" | "searching" | "found" | "rejected" | "not-found" | "load-failed";

const status = ref<RelayStatus>("idle");
const copyLabel = ref("Copy prompt");
const fixCopyLabel = ref("Copy prompt");
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

async function copyTo(label: Ref<string>, text: string) {
  try {
    await navigator.clipboard.writeText(text);
    label.value = "Copied";
  } catch {
    label.value = "Copying is blocked — select the text";
  }
}

const copy = () => copyTo(copyLabel, prompt);
const copyFix = () => copyTo(fixCopyLabel, fixPrompt);

onMounted(() => window.addEventListener("message", onMessage));
onBeforeUnmount(() => {
  window.removeEventListener("message", onMessage);
  clearTimeout(settle);
});

const steps = [
  { step: 1, label: "About", title: "What this is" },
  { step: 2, label: "Set up", title: "Set up your agent" },
  { step: 3, label: "Connect", title: "Connect this page" },
  { step: 4, label: "Done", title: "Connected" },
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

watch(connected, (isConnected) => {
  if (isConnected) step.value = 4;
});
</script>

<template>
  <div :data-relay-status="status">
    <Button
      variant="outline"
      data-action="open-agent-wizard"
      type="button"
      @click="open = true"
    >
      <Plug />
      Try with your own coding agent
      <Badge v-if="connected" variant="secondary">Connected</Badge>
    </Button>

    <div ref="wizardHost" />

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
              :disabled="item.step === 4 && !connected"
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

          <!-- 1. What this is -->
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
              is a small open-source program that runs on your computer and
              passes messages between this page and your agent.
            </p>
            <p>
              This page has no server behind it, and nothing leaves your
              machine.
            </p>
            <p class="text-muted-foreground">
              Learn more:
              <a
                class="underline underline-offset-4"
                href="https://docs.mcp-b.ai"
                target="_blank"
                rel="noreferrer"
                >MCP-B docs</a
              >
              ·
              <a
                class="underline underline-offset-4"
                href="https://developer.chrome.com/docs/ai/webmcp"
                target="_blank"
                rel="noreferrer"
                >WebMCP in Chrome</a
              >
              ·
              <a
                class="underline underline-offset-4"
                href="https://developer.chrome.com/blog/local-network-access"
                target="_blank"
                rel="noreferrer"
                >Chrome’s local network access prompt</a
              >
            </p>
          </div>

          <!-- 2. Set up your agent -->
          <div v-else-if="step === 2" class="grid gap-3 text-sm">
            <p>
              Paste this prompt to your coding agent. It installs the relay,
              nothing else, and changes no project files. Restart your agent
              when it asks you to, then continue here.
            </p>
            <div
              class="max-h-[45svh] overflow-auto rounded-md border bg-muted/50 p-3"
            >
              <pre
                class="font-mono text-xs leading-relaxed whitespace-pre-wrap"
                >{{ prompt }}</pre>
            </div>
            <div>
              <Button
                variant="secondary"
                size="sm"
                data-action="copy-prompt"
                type="button"
                @click="copy"
              >
                {{ copyLabel }}
              </Button>
            </div>
          </div>

          <!-- 3. Connect this page -->
          <div v-else-if="step === 3" class="grid gap-3 text-sm">
            <p class="text-muted-foreground">
              The relay runs on your computer, and Chrome asks before it lets
              any website talk to programs on your device. Allowing it lets this
              page reach the relay. The permission applies to this site only,
              and you can revoke it in Chrome’s site settings.
            </p>
            <div
              aria-live="polite"
              class="grid gap-2 rounded-md border bg-muted/50 p-3"
            >
              <p v-if="status === 'idle'" class="text-muted-foreground">
                Nothing is loaded yet. Choose “Relay installed — connect” below
                and allow Chrome’s prompt.
              </p>
              <p v-else-if="status === 'searching'" class="flex gap-2">
                <LoaderCircle class="mt-0.5 size-4 shrink-0 animate-spin" />
                Looking for the relay on your computer…
              </p>
              <p v-else-if="status === 'found'" class="flex gap-2">
                <Check class="mt-0.5 size-4 shrink-0" />
                Connected to your relay.
              </p>
              <template v-else-if="status === 'rejected'">
                <p class="flex gap-2 text-destructive" role="alert">
                  <CircleAlert class="mt-0.5 size-4 shrink-0" />
                  <span>
                    A relay answered but refused this page: it was started for a
                    different address. Paste this prompt to your agent, restart
                    the agent when it asks, then try again.
                  </span>
                </p>
                <pre
                  data-fix-prompt
                  class="max-h-[30svh] overflow-auto rounded-md border bg-background p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap"
                  >{{ fixPrompt }}</pre>
                <div>
                  <Button
                    variant="secondary"
                    size="sm"
                    data-action="copy-fix-prompt"
                    type="button"
                    @click="copyFix"
                  >
                    {{ fixCopyLabel }}
                  </Button>
                </div>
              </template>
              <p v-else-if="status === 'not-found'" class="flex gap-2">
                <CircleAlert class="mt-0.5 size-4 shrink-0" />
                <span>
                  No relay found yet. Either the agent still needs a restart
                  after installing it, or Chrome’s permission prompt was denied
                  or dismissed.
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

          <!-- 4. Connected -->
          <div v-else class="grid gap-3 text-sm">
            <p class="flex gap-2 font-medium">
              <Check class="mt-0.5 size-4 shrink-0" />
              This page is connected to the relay.
            </p>
            <p>
              Paste the same prompt to your agent again. It will list this
              page’s tools and suggest one to try.
            </p>
            <p class="text-muted-foreground">
              Close this dialog first: while it is open the page behind it is
              blocked, so a tool call from your agent would time out.
            </p>
            <div>
              <Button
                variant="secondary"
                size="sm"
                data-action="copy-prompt"
                type="button"
                @click="copy"
              >
                {{ copyLabel }}
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button
              v-if="step > 1 && step < 4"
              variant="outline"
              data-action="wizard-back"
              type="button"
              @click="step -= 1"
            >
              Back
            </Button>
            <Button
              v-if="step < 3"
              data-action="wizard-next"
              type="button"
              @click="step += 1"
            >
              Next
            </Button>
            <Button
              v-else-if="
                step === 3 && (status === 'not-found' || status === 'rejected')
              "
              data-action="retry-relay"
              type="button"
              @click="retry"
            >
              Try again
            </Button>
            <Button
              v-else-if="step === 3"
              data-action="connect-relay"
              type="button"
              :disabled="status === 'searching' || status === 'found'"
              @click="connect"
            >
              Relay installed — connect
            </Button>
            <Button
              v-else
              data-action="wizard-done"
              type="button"
              @click="open = false"
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfigProvider>
  </div>
</template>
